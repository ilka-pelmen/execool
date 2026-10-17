package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

func (self *SessionRunner) sanitizeSessionPath(sessionId string) (string, error) {
	if sessionId == "" {
		return "", fmt.Errorf("Session ID is empty")
	}

	sessionDir := filepath.Clean(filepath.Join(self.Conf.BaseSessionsDir, sessionId))

	if !strings.HasPrefix(sessionDir, self.Conf.BaseSessionsDir+string(filepath.Separator)) {
		return "", fmt.Errorf("Insecure path, access denied")
	}

	return sessionDir, nil
}

func (self *SessionRunner) sanitizeFilePath(sessionId string, filePath string) (string, error) {
	sessionDir, err := self.sanitizeSessionPath(sessionId)
	if err != nil {
		return "", err
	}

	if filePath == "" {
		return "", fmt.Errorf("Filepath is empty")
	}

	targetPath := filepath.Clean(filepath.Join(sessionDir, filePath))
	if !strings.HasPrefix(targetPath, sessionDir+string(filepath.Separator)) {
		return "", fmt.Errorf("insecure file path, access denied")
	}

	return targetPath, nil
}

func (self *SessionRunner) InitializeBaseImage() error {
	fmt.Printf("Checking if image '%s' exists locally...\n", self.Conf.BaseImage)

	checkCmd := exec.Command("podman", "image", "exists", self.Conf.BaseImage)
	if err := checkCmd.Run(); err == nil {
		fmt.Printf("Image '%s' is already present locally.\n", self.Conf.BaseImage)
		return nil
	}

	fmt.Printf("Image '%s' not found locally. Downloading (pulling)... Please wait.\n", self.Conf.BaseImage)
	pullCmd := exec.Command("podman", "pull", self.Conf.BaseImage)
	pullCmd.Stdout = os.Stdout
	pullCmd.Stderr = os.Stderr

	if err := pullCmd.Run(); err != nil {
		return fmt.Errorf("failed to pull image %s: %v", self.Conf.BaseImage, err)
	}

	fmt.Printf("Successfully pulled '%s'.\n", self.Conf.BaseImage)
	return nil
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

	if err := os.MkdirAll(sessionDir, 0700); err != nil {
		http.Error(w, "Could not create workspace", http.StatusInternalServerError)
		return
	}

	cmd := exec.Command(
		"podman",
		"run", "-d",
		"--name", self.Conf.ContainerPrefix+req.SessionID,
		"--network", "none",
		"--cgroups=disabled",
		// Добавляем настройки кодировки для каждого контейнера:
		"-e", "PYTHONIOENCODING=utf-8",
		"-e", "LANG=C.UTF-8",
		"-v", sessionDir+":/app:z",
		"-w", "/app",
		"-it", self.Conf.BaseImage,
		"sleep", "infinity")

	output, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Printf("[Podman Error] session: %s, err: %v, output: %s\n", req.SessionID, err, string(output))
		http.Error(w, "Could not start a session: "+req.SessionID, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// POST /session/{sessionId}/run
func (self *SessionRunner) ExecEndpoint(w http.ResponseWriter, r *http.Request) {
	sessionId := r.PathValue("sessionId")
	var req SessionRun
	if err := json.NewDecoder(r.Body).Decode(&req); sessionId == "" || err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	cmd := exec.Command("podman", "exec", "-i", self.Conf.ContainerPrefix+sessionId, "sh", "-c", req.Command)

	output, err := cmd.CombinedOutput()
	exitCode := 0

	if err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			exitCode = exitError.ExitCode()
		} else {
			exitCode = -1
		}
	}

	result := SessionRunResult{ExitCode: exitCode, Output: string(output)}
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

	cmd := exec.Command("podman", "rm", "-f", self.Conf.ContainerPrefix+sessionId)

	_, err := cmd.CombinedOutput()
	if err != nil {
		http.Error(w, "Could not remove a session: "+sessionId, http.StatusInternalServerError)
		return
	}

	if err := os.RemoveAll(sessionDir); err != nil {
		fmt.Printf("Warning: could not remove session dir %s: %v\n", sessionDir, err)
	}

	w.WriteHeader(http.StatusOK)
}

// PUT /session/{sessionId}/file?path=src/main.py
func (self *SessionRunner) PutFileEndpoint(w http.ResponseWriter, r *http.Request) {
	sessionId := r.PathValue("sessionId")
	filePath := r.URL.Query().Get("path")

	targetPath, err := self.sanitizeFilePath(sessionId, filePath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	content, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Could not read request body", http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll(filepath.Dir(targetPath), 0700); err != nil {
		http.Error(w, "Could not create parent directories", http.StatusInternalServerError)
		return
	}

	if err := os.WriteFile(targetPath, content, 0600); err != nil {
		http.Error(w, "Could not write file", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// DELETE /session/{sessionId}/file?path=src/main.py
func (self *SessionRunner) DeleteFileEndpoint(w http.ResponseWriter, r *http.Request) {
	sessionId := r.PathValue("sessionId")

	filePath := r.URL.Query().Get("path")

	targetPath, err := self.sanitizeFilePath(sessionId, filePath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := os.Remove(targetPath); err != nil && !os.IsNotExist(err) {
		http.Error(w, "Could not delete file", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// GET /session/{sessionId}/file?path=src/main.py
func (self *SessionRunner) GetFileEndpoint(w http.ResponseWriter, r *http.Request) {
	sessionId := r.PathValue("sessionId")

	filePath := r.URL.Query().Get("path")

	targetPath, err := self.sanitizeFilePath(sessionId, filePath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	content, err := os.ReadFile(targetPath)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
		http.Error(w, "Could not read file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(content)
}

// GET /session/{sessionId}/files
func (self *SessionRunner) ListFilesEndpoint(w http.ResponseWriter, r *http.Request) {
	sessionId := r.PathValue("sessionId")
	sessionDir, err := self.sanitizeSessionPath(sessionId)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var files []string
	err = filepath.WalkDir(sessionDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if path == sessionDir {
			return nil
		}

		if !d.IsDir() {
			rel, err := filepath.Rel(sessionDir, path)
			if err != nil {
				return err
			}
			files = append(files, filepath.ToSlash(rel))
		}
		return nil
	})

	if err != nil {
		http.Error(w, "Could not list files", http.StatusInternalServerError)
		return
	}

	if files == nil {
		files = []string{}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(files)
}
