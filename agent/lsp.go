package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// LSP по stdio передаёт сообщения как "Content-Length: N\r\n\r\n<N байт JSON>".
// WebSocket передаёт каждое сообщение целым кадром, поэтому мост переводит одно в другое.

// readMessage читает одно сообщение LSP из потока.
func readMessage(r *bufio.Reader, maxSize int64) ([]byte, error) {
	length := int64(-1)

	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}

		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break // пустая строка: заголовки закончились
		}

		name, value, found := strings.Cut(line, ":")
		if found && strings.EqualFold(strings.TrimSpace(name), "Content-Length") {
			n, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
			if err != nil || n < 0 {
				return nil, fmt.Errorf("bad Content-Length: %q", value)
			}
			length = n
		}
	}

	if length < 0 {
		return nil, errors.New("missing Content-Length header")
	}
	if length > maxSize {
		return nil, fmt.Errorf("message too large: %d bytes", length)
	}

	body := make([]byte, length)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, err
	}
	return body, nil
}

// writeMessage записывает одно сообщение LSP в поток.
func writeMessage(w io.Writer, body []byte) error {
	if _, err := fmt.Fprintf(w, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		return err
	}
	_, err := w.Write(body)
	return err
}

// Конфигурации анализаторов, которые агент сам кладёт в папку сессии. Проект свои
// конфигурации подложить не может (см. ignoredNamesByLanguage), поэтому здесь единственный
// источник настроек языкового сервера.
var analyzerConfigs = map[string]struct{ name, content string }{
	"python": {
		name: "pyrefly.toml",
		// Без конфигурации Pyrefly добавляет в пути поиска импортов все родительские папки
		// до корня файловой системы (/tmp/execool-lsp, /tmp, ...). Они попадают в тексты
		// ошибок, а модули оттуда стали бы импортироваться. Оставляем только папку проекта.
		content: "search-path = [\".\"]\ndisable-search-path-heuristics = true\nskip-interpreter-query = true\nsite-package-path = []\npython-version = \"3.14\"\n",
	},
}

func writeAnalyzerConfig(dir, language string) error {
	cfg, ok := analyzerConfigs[strings.ToLower(language)]
	if !ok {
		return nil
	}
	return os.WriteFile(filepath.Join(dir, cfg.name), []byte(cfg.content), 0o600)
}

// Причины закрытия подключения. Они превращаются в коды закрытия WebSocket (см. closeStatus).
var (
	errIdle     = errors.New("idle timeout")
	errReplaced = errors.New("replaced by a newer connection")
)

// Коды закрытия WebSocket (диапазон 4000-4999 отдан приложениям).
const (
	closeSessionGone  websocket.StatusCode = 4001 // сессия удалена или истекла
	closeStartFailed  websocket.StatusCode = 4002 // языковой сервер не запустился
	closeIdleTimeout  websocket.StatusCode = 4003 // подключение закрыто по простою
	closeReplacedConn websocket.StatusCode = 4010 // вытеснено новым подключением
)

// LSPHost запускает по одному процессу языкового сервера на каждое WebSocket-подключение
// и перекладывает сообщения между браузером и процессом.
type LSPHost struct {
	ctx   context.Context // отменяется при остановке агента
	conf  *Config
	slots chan struct{} // семафор: не больше MaxLSP процессов
	wg    sync.WaitGroup
}

func NewLSPHost(ctx context.Context, conf *Config) *LSPHost {
	return &LSPHost{
		ctx:   ctx,
		conf:  conf,
		slots: make(chan struct{}, conf.MaxLSP),
	}
}

func (h *LSPHost) Active() int    { return len(h.slots) }
func (h *LSPHost) FreeSlots() int { return cap(h.slots) - len(h.slots) }

// Wait ждёт завершения активных подключений, но не дольше timeout.
func (h *LSPHost) Wait(timeout time.Duration) {
	done := make(chan struct{})
	go func() {
		h.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(timeout):
		log.Println("[LSP] not all connections finished in time")
	}
}

// Serve обслуживает одно подключение: апгрейд WebSocket, процесс, перекладывание сообщений.
// Токен и сессия уже проверены вызывающим.
func (h *LSPHost) Serve(w http.ResponseWriter, r *http.Request, session *Session) {
	h.wg.Add(1)
	defer h.wg.Done()

	ctx, cancel := context.WithCancelCause(h.ctx)
	defer cancel(nil)

	// Новое подключение вытесняет старое: дожидаемся, пока старое завершится.
	done := make(chan struct{})
	prevCancel, prevDone := session.attachLSP(cancel, done)
	defer session.detachLSP(done)
	defer close(done)

	if prevCancel != nil {
		prevCancel(errReplaced)
		select {
		case <-prevDone:
		case <-time.After(5 * time.Second):
		}
	}

	select {
	case h.slots <- struct{}{}:
		defer func() { <-h.slots }()
	default:
		writeAPIError(w, newAPIError(http.StatusServiceUnavailable, "capacity", "Слишком много активных подключений"))
		return
	}

	// Accept сам проверяет Origin и при несовпадении отвечает 403.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: h.conf.originHostPatterns(),
	})
	if err != nil {
		log.Printf("[LSP] session %s: websocket accept: %v", session.ID, err)
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(h.conf.MaxMessageSize)

	// В начале Serve, до запуска процесса:
	languageID := strings.ToLower(strings.TrimSpace(session.Language))
	lspCommand, ok := h.conf.LSPCommands[languageID]
	if !ok {
		writeAPIError(w, newAPIError(
			http.StatusBadRequest,
			"unsupported_language",
			"Для этого языка не настроен LSP-сервер",
		))
		return
	}

	cmd := exec.CommandContext(ctx, lspCommand[0], lspCommand[1:]...)
	cmd.Dir = session.Dir
	cmd.Env = lspEnvironment(session.Dir)
	cmd.Stderr = os.Stderr
	cmd.WaitDelay = 2 * time.Second

	stdin, err := cmd.StdinPipe()
	if err != nil {
		startFailed(conn, session, "stdin pipe", err)
		return
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		startFailed(conn, session, "stdout pipe", err)
		return
	}
	if err := cmd.Start(); err != nil {
		startFailed(conn, session, "start "+lspCommand[0], err)
		return
	}
	log.Printf("[LSP] session %s: language server started (pid %d)", session.ID, cmd.Process.Pid)

	// Процесс завершился сам (или был убит): закрываем подключение.
	exited := make(chan struct{})
	go func() {
		cmd.Wait()
		close(exited)
		cancel(nil)
	}()

	// Подключение закрывается, если у сессии не было активности дольше LSPIdle.
	// Активность - это и сообщения LSP, и любой запрос с токеном (например, heartbeat
	// браузера: GET /sessions/{id}), потому что и то и другое отмечается в session.Touch.
	go func() {
		timer := time.NewTimer(h.conf.LSPIdle)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				remaining := h.conf.LSPIdle - time.Since(session.LastActivity())
				if remaining <= 0 {
					cancel(errIdle)
					return
				}
				timer.Reset(remaining)
			}
		}
	}()
	touch := session.Touch

	// Браузер видит виртуальный корень вместо настоящей папки сессии.
	mapper := newPathMapper(session.Dir)

	// Браузер -> языковой сервер.
	go func() {
		defer cancel(nil)
		defer stdin.Close()

		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			touch()
			if err := writeMessage(stdin, mapper.ToServer(data)); err != nil {
				return
			}
		}
	}()

	// Языковой сервер -> браузер.
	go func() {
		defer cancel(nil)
		reader := bufio.NewReader(stdout)

		for {
			body, err := readMessage(reader, h.conf.MaxMessageSize)
			if err != nil {
				return
			}
			touch()

			body = mapper.ToClient(body)
			writeCtx, writeDone := context.WithTimeout(ctx, 10*time.Second)
			err = conn.Write(writeCtx, websocket.MessageText, body)
			writeDone()
			if err != nil {
				return
			}
		}
	}()

	<-ctx.Done()
	code, reason := closeStatus(context.Cause(ctx))
	conn.Close(code, reason)
	<-exited // процесс остановлен контекстом
	log.Printf("[LSP] session %s: language server stopped", session.ID)
}

func startFailed(conn *websocket.Conn, session *Session, what string, err error) {
	log.Printf("[LSP] session %s: cannot %s: %v", session.ID, what, err)
	conn.Close(closeStartFailed, "cannot start language server")
}

// closeStatus выбирает код закрытия WebSocket по причине остановки.
func closeStatus(cause error) (websocket.StatusCode, string) {
	switch {
	case errors.Is(cause, errIdle):
		return closeIdleTimeout, "idle timeout"
	case errors.Is(cause, errReplaced):
		return closeReplacedConn, "replaced by a newer connection"
	case errors.Is(cause, errSessionGone):
		return closeSessionGone, "session closed"
	default:
		return websocket.StatusNormalClosure, ""
	}
}

// lspEnvironment: процесс получает минимальное окружение. Секреты агента
// (AGENT_API_KEY, AGENT_TOKEN_SECRET) и чужие переменные ему не передаются.
func lspEnvironment(home string) []string {
	env := []string{"HOME=" + home, "USERPROFILE=" + home, "LANG=C.UTF-8"}
	for _, key := range []string{"PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR"} {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	return env
}
