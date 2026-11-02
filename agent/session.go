package main

import (
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const dirPrefix = "session-"

var errSessionGone = errors.New("session is gone")
var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Session: рабочая папка проекта и (необязательно) подключённый языковой сервер.
type Session struct {
	ID        string
	Language  string
	Dir       string
	Created   time.Time
	Workspace *Workspace
	lastNano  atomic.Int64
	mu        sync.Mutex
	lspCancel context.CancelCauseFunc
	lspDone   chan struct{}
}

func (s *Session) Touch()                  { s.lastNano.Store(time.Now().UnixNano()) }
func (s *Session) LastActivity() time.Time { return time.Unix(0, s.lastNano.Load()) }

// attachLSP регистрирует новое подключение и возвращает предыдущее (его нужно закрыть).
func (s *Session) attachLSP(cancel context.CancelCauseFunc, done chan struct{}) (context.CancelCauseFunc, chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	prevCancel, prevDone := s.lspCancel, s.lspDone
	s.lspCancel, s.lspDone = cancel, done
	return prevCancel, prevDone
}

func (s *Session) detachLSP(done chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lspDone == done {
		s.lspCancel, s.lspDone = nil, nil
	}
}

// cancelLSP закрывает подключение и возвращает канал, который закроется после его завершения.
func (s *Session) cancelLSP(cause error) chan struct{} {
	s.mu.Lock()
	cancel, done := s.lspCancel, s.lspDone
	s.mu.Unlock()
	if cancel == nil {
		return nil
	}
	cancel(cause)
	return done
}

// maxExpiresAt: момент, когда сессия будет удалена по абсолютному сроку (пусто, если лимита нет).
func (s *Session) maxExpiresAt(max time.Duration) string {
	if max <= 0 {
		return ""
	}
	return s.Created.Add(max).UTC().Format(time.RFC3339)
}

func (s *Session) hasLSP() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lspDone != nil
}

// SessionManager: реестр сессий на агенте.
type SessionManager struct {
	conf     *Config
	mu       sync.Mutex
	sessions map[string]*Session
}

func NewSessionManager(conf *Config) *SessionManager {
	return &SessionManager{conf: conf, sessions: make(map[string]*Session)}
}

// Start создаёт корневую папку и убирает хвосты прошлого запуска (только папки session-*).
func (m *SessionManager) Start() error {
	if err := os.MkdirAll(m.conf.WorkspaceRoot, 0o700); err != nil {
		return err
	}
	entries, err := os.ReadDir(m.conf.WorkspaceRoot)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), dirPrefix) {
			os.RemoveAll(filepath.Join(m.conf.WorkspaceRoot, entry.Name()))
		}
	}
	return nil
}

// Create создаёт сессию с заданным идентификатором. Повторный вызов возвращает ту же сессию.
func (m *SessionManager) Create(id string, language string) (*Session, error) {
	if !idPattern.MatchString(id) {
		return nil, newAPIError(400, "invalid_id", "Недопустимый идентификатор сессии")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.sessions[id]; ok {
		existing.Touch()
		return existing, nil
	}
	if len(m.sessions) >= m.conf.MaxSessions {
		return nil, newAPIError(503, "capacity", "Агент занят, попробуйте позже")
	}
	dir := filepath.Join(m.conf.WorkspaceRoot, dirPrefix+id)
	os.RemoveAll(dir) // здесь мог остаться мусор от прошлого запуска
	if err := os.Mkdir(dir, 0o700); err != nil {
		return nil, err
	}
	session := &Session{ID: id, Language: language, Dir: dir, Created: time.Now(), Workspace: NewWorkspace(dir, m.conf.Limits, language)}
	session.Touch()
	m.sessions[id] = session
	return session, nil
}

// Get возвращает сессию и продлевает её.
func (m *SessionManager) Get(id string) (*Session, error) {
	m.mu.Lock()
	session := m.sessions[id]
	m.mu.Unlock()

	if session == nil {
		return nil, newAPIError(404, "session_not_found", "Сессия не найдена или истекла")
	}
	session.Touch()
	return session, nil
}

// Delete удаляет сессию: закрывает языковой сервер и убирает папку. Повторный вызов безопасен.
func (m *SessionManager) Delete(id string) {
	m.mu.Lock()
	session := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if session == nil {
		return
	}
	if done := session.cancelLSP(errSessionGone); done != nil {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
		}
	}
	if err := os.RemoveAll(session.Dir); err != nil {
		log.Printf("[Session] cannot remove %s: %v", session.Dir, err)
	}
}

// Reap удаляет сессии без активности и без подключённого языкового сервера,
// а также любые сессии старше SessionMax (даже если они активны).
func (m *SessionManager) Reap() int {
	now := time.Now()
	var expired []string
	m.mu.Lock()
	for id, session := range m.sessions {
		idle := now.Sub(session.LastActivity()) > m.conf.SessionIdle && !session.hasLSP()
		tooOld := m.conf.SessionMax > 0 && now.Sub(session.Created) > m.conf.SessionMax
		if idle || tooOld {
			expired = append(expired, id)
		}
	}
	m.mu.Unlock()
	for _, id := range expired {
		m.Delete(id)
	}
	return len(expired)
}

func (m *SessionManager) RunReaper(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if n := m.Reap(); n > 0 {
				log.Printf("[Session] removed idle sessions: %d", n)
			}
		}
	}
}

func (m *SessionManager) Shutdown() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.Delete(id)
	}
}

func (m *SessionManager) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sessions)
}
