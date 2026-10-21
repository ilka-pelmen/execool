package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type SessionRunner struct {
	Conf Config
}

type SessionStart struct {
	SessionID string `json:"session_id"`
}

type SessionRun struct {
	Command string `json:"command"`
}

type SessionRunResult struct {
	ExitCode int    `json:"exit_code"`
	Output   string `json:"output"`
}

var sessionIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func (self *SessionRunner) sanitizeSessionPath(sessionId string) (string, error) {
	if !sessionIDRe.MatchString(sessionId) {
		return "", fmt.Errorf("invalid session id")
	}
	return filepath.Join(self.Conf.BaseSessionsDir, sessionId), nil
}

func (self *SessionRunner) openSessionRoot(sessionId string) (*os.Root, error) {
	sessionDir, err := self.sanitizeSessionPath(sessionId)
	if err != nil {
		return nil, err
	}
	return os.OpenRoot(sessionDir)
}

func (self *SessionRunner) InitializeBaseImage() error {
	log.Printf("Checking if image '%s' exists locally...\n", self.Conf.BaseImage)

	checkCmd := exec.Command("podman", "image", "exists", self.Conf.BaseImage)
	if err := checkCmd.Run(); err == nil {
		log.Printf("Image '%s' is already present locally.\n", self.Conf.BaseImage)
		return nil
	}

	log.Printf("Image '%s' not found locally. Downloading (pulling)... Please wait.\n", self.Conf.BaseImage)
	pullCmd := exec.Command("podman", "pull", self.Conf.BaseImage)
	pullCmd.Stdout = os.Stdout
	pullCmd.Stderr = os.Stderr

	if err := pullCmd.Run(); err != nil {
		return fmt.Errorf("failed to pull image %s: %v", self.Conf.BaseImage, err)
	}

	log.Printf("Successfully pulled '%s'.\n", self.Conf.BaseImage)
	return nil
}

func (self *SessionRunner) RemoveAllContainers() {
	out, err := exec.Command("podman", "ps", "-aq", "--filter", "label=code-agent=1").Output()
	if err != nil {
		log.Printf("list containers: %v", err)
		return
	}
	ids := strings.Fields(string(out))
	if len(ids) == 0 {
		return
	}
	args := append([]string{"rm", "-f", "-t", "0", "--ignore"}, ids...)
	if err := exec.Command("podman", args...).Run(); err != nil {
		log.Printf("remove containers: %v", err)
	}
}

// POST /session/start
func (self *SessionRunner) StartEndpoint(w http.ResponseWriter, r *http.Request) {
	var req SessionStart
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	sessionDir, dir_err := self.sanitizeSessionPath(req.SessionID)
	if dir_err != nil {
		http.Error(w, "Invalid Session ID: "+dir_err.Error(), http.StatusBadRequest)
		return
	}

	if err := os.Mkdir(sessionDir, 0700); err != nil {
		if errors.Is(err, fs.ErrExist) {
			http.Error(w, "Session already exists", http.StatusConflict)
			return
		}
		http.Error(w, "Could not create workspace", http.StatusInternalServerError)
		return
	}

	cmd := exec.Command(
		"podman",
		"run", "-d", "--init",
		"--name", self.Conf.ContainerPrefix+req.SessionID,
		"--label", "code-agent=1",
		"--network", "none",
		"-v", sessionDir+":/app:z",
		"-w", "/app",
		"-it", self.Conf.BaseImage,
		"sleep", "infinity")

	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[Podman Error] session: %s, err: %v, output: %s\n", req.SessionID, err, string(output))
		os.RemoveAll(sessionDir)
		http.Error(w, "Could not start a session: "+req.SessionID, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

const execGrace = 5 * time.Second // запас: timeout в контейнере должен сработать раньше запасного

// POST /session/{sessionId}/run
func (self *SessionRunner) ExecEndpoint(w http.ResponseWriter, r *http.Request) {
	sessionId := r.PathValue("sessionId")
	var req SessionRun
	if err := json.NewDecoder(r.Body).Decode(&req); !sessionIDRe.MatchString(sessionId) || err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), self.Conf.ExecTimeout+execGrace)
	defer cancel()

	cmd := exec.CommandContext(ctx, "podman", "--log-level=error", "exec", "-i",
		self.Conf.ContainerPrefix+sessionId,
		"timeout", "-s", "KILL", strconv.Itoa(int(self.Conf.ExecTimeout.Seconds())),
		"sh", "-c", req.Command)
	cmd.WaitDelay = 2 * time.Second

	pr, pw := io.Pipe()
	cmd.Stdout, cmd.Stderr = pw, pw

	var buf bytes.Buffer
	var truncated bool
	done := make(chan struct{})
	go func() {
		defer close(done)
		io.Copy(&buf, io.LimitReader(pr, int64(self.Conf.MaxOutput)))
		n, _ := io.Copy(io.Discard, pr) // дочитываем остаток, иначе процесс заблокируется на записи
		truncated = n > 0
	}()

	exitCode := 0
	if err := cmd.Run(); err != nil {
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			exitCode = exitError.ExitCode()
		} else {
			exitCode = -1
		}
	}
	pw.Close() // сообщаем читателю, что вывода больше не будет
	<-done

	output := buf.String()
	if truncated {
		output += "\n[output truncated]"
	}

	result := SessionRunResult{ExitCode: exitCode, Output: output}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(result)
}

// DELETE /session/{sessionId}
func (self *SessionRunner) DeleteEndpoint(w http.ResponseWriter, r *http.Request) {
	sessionId := r.PathValue("sessionId")
	sessionDir, dir_err := self.sanitizeSessionPath(sessionId)
	if dir_err != nil {
		http.Error(w, "Invalid session id: "+dir_err.Error(), http.StatusBadRequest)
		return
	}

	cmd := exec.Command("podman", "rm", "-f", "-t", "0", "--ignore", self.Conf.ContainerPrefix+sessionId)

	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("podman rm: %v: %s", err, out)
		http.Error(w, "Could not remove a session: "+sessionId, http.StatusInternalServerError)
		return
	}

	if err := os.RemoveAll(sessionDir); err != nil {
		log.Printf("Warning: could not remove session dir %s: %v\n", sessionDir, err)
	}

	w.WriteHeader(http.StatusOK)
}

// PUT /session/{sessionId}/file?path=src/main.py
func (self *SessionRunner) PutFileEndpoint(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "Filepath is empty", http.StatusBadRequest)
		return
	}

	root, err := self.openSessionRoot(r.PathValue("sessionId"))
	if err != nil {
		http.Error(w, "Invalid session", http.StatusBadRequest)
		return
	}
	defer root.Close()

	content, err := io.ReadAll(http.MaxBytesReader(w, r.Body, self.Conf.MaxUpload))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			http.Error(w, "File too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "Could not read request body", http.StatusBadRequest)
		return
	}

	if dir := filepath.Dir(filePath); dir != "." {
		if err := root.MkdirAll(dir, 0700); err != nil {
			http.Error(w, "Could not create parent directories", http.StatusBadRequest)
			return
		}
	}

	f, err := root.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC|syscall.O_NONBLOCK, 0600)
	if err != nil {
		http.Error(w, "Cannot open file", http.StatusBadRequest)
		return
	}
	defer f.Close()

	if info, err := f.Stat(); err != nil || !info.Mode().IsRegular() {
		http.Error(w, "Not a regular file", http.StatusBadRequest)
		return
	}

	if _, err := f.Write(content); err != nil {
		http.Error(w, "Could not write file", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// DELETE /session/{sessionId}/file?path=src/main.py
func (self *SessionRunner) DeleteFileEndpoint(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "Filepath is empty", http.StatusBadRequest)
		return
	}

	root, err := self.openSessionRoot(r.PathValue("sessionId"))
	if err != nil {
		http.Error(w, "Invalid session", http.StatusBadRequest)
		return
	}
	defer root.Close()

	if err := root.Remove(filePath); err != nil && !errors.Is(err, fs.ErrNotExist) {
		http.Error(w, "Could not delete file", http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// GET /session/{sessionId}/file?path=src/main.py
func (self *SessionRunner) GetFileEndpoint(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "Filepath is empty", http.StatusBadRequest)
		return
	}

	root, err := self.openSessionRoot(r.PathValue("sessionId"))
	if err != nil {
		http.Error(w, "Invalid session", http.StatusBadRequest)
		return
	}
	defer root.Close()

	// O_NONBLOCK: чтобы FIFO, созданный в контейнере, не подвесил открытие
	f, err := root.OpenFile(filePath, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Cannot open file", http.StatusBadRequest)
		return
	}
	defer f.Close()

	if info, err := f.Stat(); err != nil || !info.Mode().IsRegular() {
		http.Error(w, "Not a regular file", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	io.Copy(w, f)
}

// GET /session/{sessionId}/files
func (self *SessionRunner) ListFilesEndpoint(w http.ResponseWriter, r *http.Request) {
	root, err := self.openSessionRoot(r.PathValue("sessionId"))
	if err != nil {
		http.Error(w, "Invalid session", http.StatusBadRequest)
		return
	}
	defer root.Close()

	files := []string{}
	err = fs.WalkDir(root.FS(), ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type().IsRegular() { // симлинки, FIFO и сокеты не показываем
			files = append(files, p)
		}
		return nil
	})
	if err != nil {
		http.Error(w, "Could not list files", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}
