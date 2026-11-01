package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func (h *WebHandler) supportedLanguages() []string {
	languages := make([]string, 0, len(h.Config.LSPCommands))
	for language := range h.Config.LSPCommands {
		languages = append(languages, language)
	}
	sort.Strings(languages)
	return languages
}

// WebHandler: HTTP и WebSocket слой агента. Здесь маршруты, проверка ключа и токенов,
// разбор запросов и преобразование ошибок. Процессом языкового сервера занимается LSPHost.
type WebHandler struct {
	Config      *Config
	Manager     *SessionManager
	UsedTickets *usedTickets
	LSP         *LSPHost
}

func NewWebHandler(config *Config, manager *SessionManager, lsp *LSPHost) *WebHandler {
	return &WebHandler{
		Config:      config,
		Manager:     manager,
		UsedTickets: newUsedTickets(),
		LSP:         lsp,
	}
}

type handlerFunc func(w http.ResponseWriter, r *http.Request) error

type sessionHandlerFunc func(w http.ResponseWriter, r *http.Request, s *Session) error

// PublicRoutes: маршруты для браузера (токены доступа) с CORS.
func (h *WebHandler) PublicRoutes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /ping", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	mux.Handle("GET /sessions/{id}", h.sessionAuth(scopeFiles, h.SessionInfo))
	mux.Handle("PUT /sessions/{id}/files", h.sessionAuth(scopeFiles, h.ReplaceFiles))
	mux.Handle("PUT /sessions/{id}/file", h.sessionAuth(scopeFiles, h.PutFile))
	mux.Handle("DELETE /sessions/{id}/file", h.sessionAuth(scopeFiles, h.DeleteFile))

	// Для WebSocket вместо заголовка используется одноразовый билет в адресе.
	mux.HandleFunc("GET /sessions/{id}/lsp", h.ServeLSP)

	return h.cors(mux)
}

// InternalRoutes: маршруты для Spring (ключ API). Слушаются на отдельном адресе.
func (h *WebHandler) InternalRoutes() http.Handler {
	mux := http.NewServeMux()

	mux.Handle("GET /internal/status", h.internalAuth(h.Status))
	mux.Handle("POST /internal/sessions", h.internalAuth(h.CreateSession))
	mux.Handle("DELETE /internal/sessions/{id}", h.internalAuth(h.DeleteSession))

	return mux
}

// ---- проверка доступа ----

func bearerToken(header string) (string, bool) {
	fields := strings.Fields(header)
	if len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") {
		return "", false
	}
	return fields[1], true
}

func (h *WebHandler) internalAuth(next handlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok || !verifyAgentAPIKey(h.Config.APIKey, "Bearer "+key) {
			writeAPIError(w, errUnauthorized)
			return
		}
		if err := next(w, r); err != nil {
			writeAPIError(w, err)
		}
	})
}

// sessionAuth проверяет токен с нужным назначением, выданный именно на эту сессию.
func (h *WebHandler) sessionAuth(scope string, next sessionHandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")

		token, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok {
			writeAPIError(w, errUnauthorized)
			return
		}
		if _, err := verifyToken(h.Config.TokenSecret, token, h.Config.AgentID, scope, id, time.Now()); err != nil {
			writeAPIError(w, errUnauthorized)
			return
		}

		session, err := h.Manager.Get(id)
		if err != nil {
			writeAPIError(w, err)
			return
		}

		if err := next(w, r, session); err != nil {
			writeAPIError(w, err)
		}
	})
}

// ---- внутренние маршруты (Spring) ----

type createSessionRequest struct {
	ID       string `json:"id"`
	Language string `json:"language"`
}

func (h *WebHandler) CreateSession(w http.ResponseWriter, r *http.Request) error {
	var req createSessionRequest
	if err := decodeJSON(w, r, 4<<10, &req, true); err != nil {
		return err
	}

	language := strings.ToLower(strings.TrimSpace(req.Language))
	if language == "" {
		language = "python"
	}

	if _, ok := h.Config.LSPCommands[language]; !ok {
		return newAPIError(
			http.StatusBadRequest,
			"unsupported_language",
			"Язык не поддерживается: %s",
			language,
		)
	}

	session, err := h.Manager.Create(req.ID, language)
	if err != nil {
		return err
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":       session.ID,
		"language": session.Language,
		"rootUri":  fileURI(session.Dir),
		"limits": map[string]any{
			"maxFiles":      h.Config.Limits.MaxFiles,
			"maxFileBytes":  h.Config.Limits.MaxFileBytes,
			"maxTotalBytes": h.Config.Limits.MaxTotalBytes,
		},
	})
	return nil
}

func (h *WebHandler) DeleteSession(w http.ResponseWriter, r *http.Request) error {
	h.Manager.Delete(r.PathValue("id")) // повторное удаление безопасно
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *WebHandler) Status(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, map[string]any{
		"agentId":      h.Config.AgentID,
		"languages":    h.supportedLanguages(),
		"sessions":     h.Manager.Count(),
		"maxSessions":  h.Config.MaxSessions,
		"lspActive":    h.LSP.Active(),
		"lspSlotsFree": h.LSP.FreeSlots(),
	})
	return nil
}

// ---- маршруты для браузера ----
func (h *WebHandler) SessionInfo(w http.ResponseWriter, r *http.Request, s *Session) error {
	writeJSON(w, http.StatusOK, map[string]any{
		"id":           s.ID,
		"language":     s.Language,
		"files":        s.Workspace.FileCount(),
		"lspConnected": s.hasLSP(),
		"expiresAt":    s.LastActivity().Add(h.Config.SessionIdle).UTC().Format(time.RFC3339),
	})
	return nil
}

// ReplaceFiles заменяет весь набор файлов проекта (первая синхронизация).
func (h *WebHandler) ReplaceFiles(w http.ResponseWriter, r *http.Request, s *Session) error {
	var req struct {
		Files []FileEntry `json:"files"`
	}
	// Запас на JSON-экранирование: вдвое больше суммарного лимита файлов.
	if err := decodeJSON(w, r, h.Config.Limits.MaxTotalBytes*2, &req, false); err != nil {
		return err
	}

	if err := s.Workspace.ReplaceAll(req.Files); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// PutFile записывает один файл: путь в параметре path, содержимое в теле запроса.
func (h *WebHandler) PutFile(w http.ResponseWriter, r *http.Request, s *Session) error {
	filePath := r.URL.Query().Get("path")

	// Читаем не больше лимита плюс один байт: этого достаточно, чтобы заметить превышение.
	r.Body = http.MaxBytesReader(w, r.Body, h.Config.Limits.MaxFileBytes+1)
	content, err := io.ReadAll(r.Body)
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return newAPIError(http.StatusRequestEntityTooLarge, "file_too_large", "Файл больше %d байт", h.Config.Limits.MaxFileBytes)
		}
		return newAPIError(http.StatusBadRequest, "invalid_request", "Не удалось прочитать тело запроса")
	}

	if err := s.Workspace.Write(filePath, content); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *WebHandler) DeleteFile(w http.ResponseWriter, r *http.Request, s *Session) error {
	if err := s.Workspace.Delete(r.URL.Query().Get("path")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ServeLSP: WebSocket языкового сервера. Билет проверяется до апгрейда соединения,
// поэтому подделка и повтор отсекаются обычным HTTP-ответом.
func (h *WebHandler) ServeLSP(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	now := time.Now()

	ticket, err := verifyToken(h.Config.TokenSecret, r.URL.Query().Get("ticket"), h.Config.AgentID, scopeLSP, id, now)
	if err != nil || !h.UsedTickets.markUsed(ticket.JTI, ticket.Exp, now) {
		writeAPIError(w, errUnauthorized)
		return
	}

	session, err := h.Manager.Get(id)
	if err != nil {
		writeAPIError(w, err)
		return
	}

	h.LSP.Serve(w, r, session)
}

// ---- вспомогательное ----
// decodeJSON читает тело запроса как один JSON-объект с ограничением размера.
func decodeJSON(w http.ResponseWriter, r *http.Request, limit int64, v any, strict bool) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)

	dec := json.NewDecoder(r.Body)
	if strict {
		dec.DisallowUnknownFields()
	}

	if err := dec.Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return newAPIError(http.StatusRequestEntityTooLarge, "payload_too_large", "Запрос слишком большой")
		}
		return newAPIError(http.StatusBadRequest, "invalid_request", "Некорректное тело запроса")
	}

	// В теле должен быть ровно один JSON-объект.
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return newAPIError(http.StatusBadRequest, "invalid_request", "После запроса есть лишние данные")
	}
	return nil
}

// fileURI строит адрес папки в формате file:///..., как его ждут языковые серверы.
func fileURI(dir string) string {
	p := filepath.ToSlash(dir)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p // Windows: C:/... -> /C:/...
	}
	return (&url.URL{Scheme: "file", Path: p}).String()
}

// cors разрешает браузерные запросы только с адресов из AGENT_ALLOWED_ORIGINS.
// Используется для публичных маршрутов; внутренний API (Spring) CORS не получает.
func (h *WebHandler) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		if origin != "" && h.originAllowed(origin) {
			header := w.Header()
			header.Set("Access-Control-Allow-Origin", origin)
			header.Add("Vary", "Origin")
			header.Set("Cross-Origin-Resource-Policy", "cross-origin")

			if r.Method == http.MethodOptions {
				header.Set("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
				header.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				header.Set("Access-Control-Max-Age", "600")
			}
		}

		// Предварительный запрос завершаем сами; если Origin не разрешён,
		// заголовков CORS нет и браузер заблокирует основной запрос.
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (h *WebHandler) originAllowed(origin string) bool {
	for _, pattern := range h.Config.AllowedOrigins {
		if ok, _ := path.Match(pattern, origin); ok {
			return true
		}
	}
	return false
}
