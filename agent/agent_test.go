package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

var testLimits = Limits{MaxFiles: 3, MaxFileBytes: 10, MaxTotalBytes: 15}

func errCode(err error) string {
	var apiErr *apiError
	if errors.As(err, &apiErr) {
		return apiErr.Code
	}
	return ""
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return !errors.Is(err, fs.ErrNotExist)
}

func TestWorkspaceWritesNestedFiles(t *testing.T) {
	root := t.TempDir()
	ws := NewWorkspace(root, testLimits, "python")

	if err := ws.Write("main.py", []byte("print(1)")); err != nil {
		t.Fatal(err)
	}
	if err := ws.Write("src/util.py", []byte("x = 1")); err != nil {
		t.Fatal(err)
	}

	if got := readFile(t, filepath.Join(root, "main.py")); got != "print(1)" {
		t.Fatalf("main.py: %q", got)
	}
	if got := readFile(t, filepath.Join(root, "src", "util.py")); got != "x = 1" {
		t.Fatalf("util.py: %q", got)
	}
	if ws.FileCount() != 2 {
		t.Fatalf("файлов: %d", ws.FileCount())
	}
}

func TestWorkspaceLeavesNoTemporaryFiles(t *testing.T) {
	root := t.TempDir()
	ws := NewWorkspace(root, testLimits, "python")

	for _, content := range []string{"1", "2"} {
		if err := ws.Write("a.py", []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := ws.Write("d/b.py", []byte("3")); err != nil {
		t.Fatal(err)
	}

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err == nil && strings.HasPrefix(d.Name(), ".upload-") {
			t.Errorf("остался временный файл: %s", path)
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestWorkspaceRejectsBadPaths(t *testing.T) {
	ws := NewWorkspace(t.TempDir(), testLimits, "python")

	bad := []string{
		"", "/etc/passwd", "../x.py", "a/../b.py", "a//b.py", "dir/", "a b.py",
		"файл.py", "a'b.py", ".", "..", strings.Repeat("x", 121),
	}
	for _, path := range bad {
		if code := errCode(ws.Write(path, []byte("x"))); code != "invalid_path" {
			t.Errorf("путь %q: код %q, ожидали invalid_path", path, code)
		}
	}
	if code := errCode(ws.Delete("../x")); code != "invalid_path" {
		t.Errorf("Delete: код %q", code)
	}
}

func TestWorkspaceRejectsFileFolderConflicts(t *testing.T) {
	ws := NewWorkspace(t.TempDir(), testLimits, "python")

	if err := ws.Write("a", []byte("1")); err != nil {
		t.Fatal(err)
	}
	if code := errCode(ws.Write("a/b.py", []byte("2"))); code != "invalid_path" {
		t.Errorf("файл внутри файла: код %q", code)
	}

	if err := ws.Write("d/e.py", []byte("3")); err != nil {
		t.Fatal(err)
	}
	if code := errCode(ws.Write("d", []byte("4"))); code != "invalid_path" {
		t.Errorf("файл поверх папки: код %q", code)
	}
}

func TestWorkspaceEnforcesLimits(t *testing.T) {
	ws := NewWorkspace(t.TempDir(), testLimits, "python")

	if code := errCode(ws.Write("big", []byte("12345678901"))); code != "file_too_large" {
		t.Errorf("большой файл: код %q", code)
	}

	if err := ws.Write("a", []byte("1234567890")); err != nil {
		t.Fatal(err)
	}
	if err := ws.Write("b", []byte("12345")); err != nil {
		t.Fatal(err)
	}
	if code := errCode(ws.Write("c", []byte("1"))); code != "session_too_large" {
		t.Errorf("общий размер: код %q", code)
	}

	if err := ws.Write("c", nil); err != nil {
		t.Fatal(err)
	}
	if code := errCode(ws.Write("d", nil)); code != "too_many_files" {
		t.Errorf("число файлов: код %q", code)
	}

	// Перезапись существующего файла не считается новым файлом.
	if err := ws.Write("a", []byte("123456789")); err != nil {
		t.Fatal(err)
	}
	if err := ws.Write("c", []byte("z")); err != nil {
		t.Errorf("перезапись при исчерпанном лимите файлов: %v", err)
	}
}

func TestWorkspaceSkipsAnalyzerConfigFiles(t *testing.T) {
	root := t.TempDir()
	ws := NewWorkspace(root, testLimits, "python")

	if err := ws.Write("pyproject.toml", []byte("[tool]")); err != nil {
		t.Fatal(err)
	}
	if err := ws.Write("sub/pyrefly.toml", []byte("x")); err != nil {
		t.Fatal(err)
	}

	if ws.FileCount() != 0 || exists(filepath.Join(root, "pyproject.toml")) || exists(filepath.Join(root, "sub")) {
		t.Fatal("файлы конфигурации не должны попадать в рабочую папку")
	}
}

func TestWorkspaceDeleteIsIdempotentAndPrunesFolders(t *testing.T) {
	root := t.TempDir()
	ws := NewWorkspace(root, testLimits, "python")

	if err := ws.Write("a/b.py", []byte("1")); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := ws.Delete("a/b.py"); err != nil {
			t.Fatal(err)
		}
	}
	if err := ws.Delete("never-existed.py"); err != nil {
		t.Fatal(err)
	}

	if ws.FileCount() != 0 || exists(filepath.Join(root, "a")) {
		t.Fatal("после удаления папка должна исчезнуть")
	}

	// Имя освободилось: теперь это может быть файл.
	if err := ws.Write("a", []byte("файл")); err != nil {
		t.Fatalf("файл с именем бывшей папки: %v", err)
	}
}

func TestWorkspaceReplaceAll(t *testing.T) {
	root := t.TempDir()
	ws := NewWorkspace(root, testLimits, "python")

	if err := ws.Write("old.py", []byte("1")); err != nil {
		t.Fatal(err)
	}
	if err := ws.Write("pkg/old2.py", []byte("2")); err != nil {
		t.Fatal(err)
	}

	err := ws.ReplaceAll([]FileEntry{
		{Path: "main.py", Content: "hello"},
		{Path: "pkg/new.py", Content: ""},
	})
	if err != nil {
		t.Fatal(err)
	}

	if got := ws.Paths(); !reflect.DeepEqual(got, []string{"main.py", "pkg/new.py"}) {
		t.Fatalf("файлы: %v", got)
	}
	if got := readFile(t, filepath.Join(root, "main.py")); got != "hello" {
		t.Fatalf("main.py: %q", got)
	}
	if exists(filepath.Join(root, "old.py")) || exists(filepath.Join(root, "pkg", "old2.py")) {
		t.Fatal("старые файлы должны быть удалены")
	}
}

func TestWorkspaceReplaceAllValidatesBeforeTouchingDisk(t *testing.T) {
	root := t.TempDir()
	ws := NewWorkspace(root, testLimits, "python")
	if err := ws.Write("keep.py", []byte("1")); err != nil {
		t.Fatal(err)
	}

	badSets := map[string][]FileEntry{
		"повтор пути":     {{Path: "a.py", Content: "1"}, {Path: "a.py", Content: "2"}},
		"плохой путь":     {{Path: "a.py", Content: "1"}, {Path: "../x.py", Content: "2"}},
		"файл и папка":    {{Path: "a", Content: "1"}, {Path: "a/b.py", Content: "2"}},
		"слишком большой": {{Path: "big.py", Content: "12345678901"}},
		"слишком много":   {{Path: "1"}, {Path: "2"}, {Path: "3"}, {Path: "4"}},
	}

	for name, set := range badSets {
		if err := ws.ReplaceAll(set); err == nil {
			t.Errorf("%s: ожидали ошибку", name)
		}
		if got := ws.Paths(); !reflect.DeepEqual(got, []string{"keep.py"}) {
			t.Errorf("%s: прежний набор должен остаться, а получили %v", name, got)
		}
		if readFile(t, filepath.Join(root, "keep.py")) != "1" {
			t.Errorf("%s: keep.py изменился", name)
		}
	}
}

func TestFramingRoundTrip(t *testing.T) {
	messages := []string{`{"jsonrpc":"2.0","id":1}`, `{"text":"привет"}`, ``}

	var buf bytes.Buffer
	for _, m := range messages {
		if err := writeMessage(&buf, []byte(m)); err != nil {
			t.Fatal(err)
		}
	}

	reader := bufio.NewReader(&buf)
	for _, want := range messages {
		got, err := readMessage(reader, 1024)
		if err != nil {
			t.Fatalf("readMessage: %v", err)
		}
		if string(got) != want {
			t.Fatalf("получили %q, ожидали %q", got, want)
		}
	}

	if _, err := readMessage(reader, 1024); !errors.Is(err, io.EOF) {
		t.Fatalf("после последнего сообщения ожидали EOF, получили %v", err)
	}
}

func TestFramingHeaders(t *testing.T) {
	raw := "content-length: 5\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\nhello"

	got, err := readMessage(bufio.NewReader(strings.NewReader(raw)), 1024)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello" {
		t.Fatalf("получили %q", got)
	}
}

func TestFramingErrors(t *testing.T) {
	cases := map[string]string{
		"нет Content-Length":  "Content-Type: x\r\n\r\nhello",
		"не число":            "Content-Length: abc\r\n\r\nhello",
		"отрицательная длина": "Content-Length: -1\r\n\r\n",
		"слишком большое":     "Content-Length: 2000\r\n\r\n",
		"тело обрезано":       "Content-Length: 10\r\n\r\nabc",
		"заголовок без конца": "Content-Length: 5",
	}

	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := readMessage(bufio.NewReader(strings.NewReader(raw)), 1024); err == nil {
				t.Fatal("ожидали ошибку")
			}
		})
	}
}

const (
	testAPIKey = "test-api-key-0123456789"
	testSecret = "test-secret-0123456789abcdef0123456789"
)

func newTestHandler(t *testing.T) (*WebHandler, *Config) {
	t.Helper()

	cfg := &Config{
		AgentID:     "agent-1",
		APIKey:      testAPIKey,
		TokenSecret: []byte(testSecret),
		LSPCommands: map[string][]string{
			"python": {"true"},
		},
		AllowedOrigins: []string{"http://localhost:*"},
		WorkspaceRoot:  t.TempDir(),
		MaxSessions:    2,
		MaxLSP:         1,
		SessionIdle:    time.Minute,
		LSPIdle:        time.Minute,
		Limits:         Limits{MaxFiles: 5, MaxFileBytes: 100, MaxTotalBytes: 300},
		MaxMessageSize: 1 << 20,
	}

	manager := NewSessionManager(cfg)
	if err := manager.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(manager.Shutdown)

	lsp := NewLSPHost(context.Background(), cfg)
	return NewWebHandler(cfg, manager, lsp), cfg
}

// mintToken повторяет то, что делает Spring: тот же формат и подпись.
func mintToken(secret []byte, aud, sid, scope string, exp int64) string {
	payload, _ := json.Marshal(map[string]any{
		"sid":   sid,
		"scope": scope,
		"exp":   exp,
		"jti":   fmt.Sprintf("j-%d", time.Now().UnixNano()),
		"aud":   aud,
	})
	part := base64.RawURLEncoding.EncodeToString(payload)

	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(part))
	return part + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func filesToken(sid string) string {
	return mintToken([]byte(testSecret), "agent-1", sid, scopeFiles, time.Now().Add(time.Minute).Unix())
}

func bearer(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

func do(handler http.Handler, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("тело ответа не JSON: %q", rec.Body.String())
	}
	return out
}

func createSession(t *testing.T, h *WebHandler, id string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"id":"` + id + `","language":"python"}`
	return do(h.InternalRoutes(), "POST", "/internal/sessions", body, bearer(testAPIKey))
}

func expectStatus(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("статус %d, ожидали %d, тело: %s", rec.Code, status, rec.Body.String())
	}
	if code != "" {
		if got := decodeBody(t, rec)["error"]; got != code {
			t.Fatalf("код ошибки %v, ожидали %q", got, code)
		}
	}
}

func TestInternalAuth(t *testing.T) {
	h, _ := newTestHandler(t)
	internal := h.InternalRoutes()

	expectStatus(t, do(internal, "GET", "/internal/status", "", nil), 401, "unauthorized")
	expectStatus(t, do(internal, "GET", "/internal/status", "", bearer("wrong-key-0123456789")), 401, "unauthorized")

	rec := do(internal, "GET", "/internal/status", "", bearer(testAPIKey))
	expectStatus(t, rec, 200, "")
	if got := decodeBody(t, rec)["agentId"]; got != "agent-1" {
		t.Fatalf("agentId: %v", got)
	}
}

func TestCreateSessionResponse(t *testing.T) {
	h, cfg := newTestHandler(t)

	rec := createSession(t, h, "s1")
	expectStatus(t, rec, 201, "")

	body := decodeBody(t, rec)
	if body["id"] != "s1" || body["language"] != "python" {
		t.Fatalf("ответ: %v", body)
	}
	if body["rootUri"] != virtualRootURI {
		t.Fatalf("rootUri: %v", body["rootUri"])
	}
	limits, _ := body["limits"].(map[string]any)
	if limits["maxFiles"] != float64(cfg.Limits.MaxFiles) {
		t.Fatalf("limits: %v", limits)
	}
}

func TestCreateSessionValidation(t *testing.T) {
	h, _ := newTestHandler(t)
	internal := h.InternalRoutes()
	auth := bearer(testAPIKey)

	expectStatus(t, do(internal, "POST", "/internal/sessions", `{"id":"../x","language":"python"}`, auth), 400, "invalid_id")
	expectStatus(t, do(internal, "POST", "/internal/sessions", `{"id":"s1","language":"cobol"}`, auth), 400, "unsupported_language")
	expectStatus(t, do(internal, "POST", "/internal/sessions", `{"id":"s1","unknown":1}`, auth), 400, "invalid_request")
	expectStatus(t, do(internal, "POST", "/internal/sessions", `not json`, auth), 400, "invalid_request")

	// Язык по умолчанию: python.
	expectStatus(t, do(internal, "POST", "/internal/sessions", `{"id":"s2"}`, auth), 201, "")
}

func TestCreateSessionCapacityAndIdempotency(t *testing.T) {
	h, _ := newTestHandler(t) // MaxSessions = 2

	expectStatus(t, createSession(t, h, "a"), 201, "")
	expectStatus(t, createSession(t, h, "a"), 201, "") // повтор не занимает место
	expectStatus(t, createSession(t, h, "b"), 201, "")
	expectStatus(t, createSession(t, h, "c"), 503, "capacity")
}

func TestFileRoutes(t *testing.T) {
	h, cfg := newTestHandler(t)
	createSession(t, h, "s1")
	public := h.PublicRoutes()
	auth := bearer(filesToken("s1"))
	dir := filepath.Join(cfg.WorkspaceRoot, dirPrefix+"s1")

	expectStatus(t, do(public, "PUT", "/sessions/s1/file?path=main.py", "print(1)", auth), 204, "")
	if got := readFile(t, filepath.Join(dir, "main.py")); got != "print(1)" {
		t.Fatalf("main.py: %q", got)
	}

	bulk := `{"files":[{"path":"a.py","content":"1"},{"path":"src/b.py","content":"2"}]}`
	expectStatus(t, do(public, "PUT", "/sessions/s1/files", bulk, auth), 204, "")
	if exists(filepath.Join(dir, "main.py")) {
		t.Fatal("массовая замена должна убрать прежние файлы")
	}

	rec := do(public, "GET", "/sessions/s1", "", auth)
	expectStatus(t, rec, 200, "")
	if got := decodeBody(t, rec)["files"]; got != float64(2) {
		t.Fatalf("files: %v", got)
	}

	expectStatus(t, do(public, "PUT", "/sessions/s1/file?path=../evil.py", "x", auth), 400, "invalid_path")
	expectStatus(t, do(public, "PUT", "/sessions/s1/file", "x", auth), 400, "invalid_path")
	expectStatus(t, do(public, "PUT", "/sessions/s1/file?path=big.py", strings.Repeat("x", 101), auth), 413, "file_too_large")

	expectStatus(t, do(public, "DELETE", "/sessions/s1/file?path=a.py", "", auth), 204, "")
	if exists(filepath.Join(dir, "a.py")) {
		t.Fatal("a.py должен быть удалён")
	}
}

func TestSessionTokenChecks(t *testing.T) {
	h, _ := newTestHandler(t)
	createSession(t, h, "s1")
	createSession(t, h, "s2")
	public := h.PublicRoutes()
	secret := []byte(testSecret)
	future := time.Now().Add(time.Minute).Unix()

	cases := map[string]map[string]string{
		"нет заголовка":   nil,
		"мусор":           bearer("garbage"),
		"билет WebSocket": bearer(mintToken(secret, "agent-1", "s1", scopeLSP, future)),
		"другая сессия":   bearer(mintToken(secret, "agent-1", "s2", scopeFiles, future)),
		"другой агент":    bearer(mintToken(secret, "agent-2", "s1", scopeFiles, future)),
		"срок истёк":      bearer(mintToken(secret, "agent-1", "s1", scopeFiles, time.Now().Add(-time.Second).Unix())),
		"чужая подпись":   bearer(mintToken([]byte("other-secret-0123456789abcdef0123456789"), "agent-1", "s1", scopeFiles, future)),
	}

	for name, headers := range cases {
		rec := do(public, "GET", "/sessions/s1", "", headers)
		if rec.Code != 401 {
			t.Errorf("%s: статус %d, ожидали 401", name, rec.Code)
		}
	}
}

func TestSessionNotFound(t *testing.T) {
	h, _ := newTestHandler(t)

	rec := do(h.PublicRoutes(), "GET", "/sessions/ghost", "", bearer(filesToken("ghost")))
	expectStatus(t, rec, 404, "session_not_found")
}

func TestDeleteSession(t *testing.T) {
	h, cfg := newTestHandler(t)
	createSession(t, h, "s1")
	dir := filepath.Join(cfg.WorkspaceRoot, dirPrefix+"s1")
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("папка сессии не создана: %v", err)
	}

	internal := h.InternalRoutes()
	expectStatus(t, do(internal, "DELETE", "/internal/sessions/s1", "", bearer(testAPIKey)), 204, "")
	expectStatus(t, do(internal, "DELETE", "/internal/sessions/s1", "", bearer(testAPIKey)), 204, "") // повтор безопасен

	if exists(dir) {
		t.Fatal("папка сессии должна быть удалена")
	}
	rec := do(h.PublicRoutes(), "PUT", "/sessions/s1/file?path=a.py", "x", bearer(filesToken("s1")))
	expectStatus(t, rec, 404, "session_not_found")
}

func TestCORS(t *testing.T) {
	h, _ := newTestHandler(t)
	public := h.PublicRoutes()

	preflight := map[string]string{
		"Origin":                        "http://localhost:5173",
		"Access-Control-Request-Method": "PUT",
	}
	rec := do(public, "OPTIONS", "/sessions/s1/file", "", preflight)
	if rec.Code != 204 {
		t.Fatalf("preflight: статус %d", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatal("для разрешённого Origin нужен Access-Control-Allow-Origin")
	}
	if !strings.Contains(rec.Header().Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Fatal("в разрешённых заголовках должен быть Authorization")
	}

	// Чужой Origin: preflight завершается, но заголовков CORS нет.
	rec = do(public, "OPTIONS", "/sessions/s1/file", "", map[string]string{"Origin": "https://evil.example"})
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("для чужого Origin заголовков CORS быть не должно")
	}

	// Обычный запрос с разрешённым Origin тоже получает заголовок.
	rec = do(public, "GET", "/ping", "", map[string]string{"Origin": "http://localhost:3000"})
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Fatal("ответ на обычный запрос должен содержать Access-Control-Allow-Origin")
	}

	// Внутренний API CORS не получает.
	headers := bearer(testAPIKey)
	headers["Origin"] = "http://localhost:5173"
	rec = do(h.InternalRoutes(), "GET", "/internal/status", "", headers)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("внутренний API не должен отдавать заголовки CORS")
	}
}

func TestServeLSPRejectsBadTickets(t *testing.T) {
	h, _ := newTestHandler(t)
	createSession(t, h, "s1")
	public := h.PublicRoutes()
	secret := []byte(testSecret)
	future := time.Now().Add(time.Minute).Unix()

	targets := map[string]string{
		"без билета":          "/sessions/s1/lsp",
		"мусор":               "/sessions/s1/lsp?ticket=garbage",
		"билет для файлов":    "/sessions/s1/lsp?ticket=" + mintToken(secret, "agent-1", "s1", scopeFiles, future),
		"билет другой сессии": "/sessions/s1/lsp?ticket=" + mintToken(secret, "agent-1", "s2", scopeLSP, future),
	}

	for name, target := range targets {
		rec := do(public, "GET", target, "", nil)
		if rec.Code != 401 {
			t.Errorf("%s: статус %d, ожидали 401", name, rec.Code)
		}
	}
}

// Эталонный токен. Тот же формат и подпись должен выпускать и проверять Spring.
const (
	vectorSecret = "test-secret-0123456789abcdef0123456789"
	vectorToken  = "eyJzaWQiOiJzMSIsInNjb3BlIjoibHNwIiwiZXhwIjoyMDAwMDAwMDAwLCJqdGkiOiJqMSIsImF1ZCI6ImFnZW50LTEifQ.OMrKAPKygoHeC-kye888Oevj7VS-2aTfRcsJ9gF7lfo"
)

func TestVerifyTokenKnownVector(t *testing.T) {
	now := time.Unix(1_900_000_000, 0)

	c, err := verifyToken([]byte(vectorSecret), vectorToken, "agent-1", "lsp", "s1", now)
	if err != nil {
		t.Fatalf("эталонный токен не прошёл проверку: %v", err)
	}
	if c.SID != "s1" || c.Scope != "lsp" || c.JTI != "j1" || c.Aud != "agent-1" || c.Exp != 2_000_000_000 {
		t.Fatalf("неверные поля токена: %+v", c)
	}
}

func TestVerifyTokenRejects(t *testing.T) {
	secret := []byte(vectorSecret)
	valid := time.Unix(1_900_000_000, 0)

	cases := []struct {
		name   string
		secret []byte
		token  string
		aud    string
		scope  string
		sid    string
		now    time.Time
	}{
		{"изменённое содержимое", secret, "x" + vectorToken[1:], "agent-1", "lsp", "s1", valid},
		{"чужой секрет", []byte("another-secret-0123456789abcdef0123456789"), vectorToken, "agent-1", "lsp", "s1", valid},
		{"другой агент", secret, vectorToken, "agent-2", "lsp", "s1", valid},
		{"другое назначение", secret, vectorToken, "agent-1", "files", "s1", valid},
		{"другая сессия", secret, vectorToken, "agent-1", "lsp", "s2", valid},
		{"срок истёк", secret, vectorToken, "agent-1", "lsp", "s1", time.Unix(2_000_000_000, 0)},
		{"пустая строка", secret, "", "agent-1", "lsp", "s1", valid},
		{"нет точки", secret, "abcdef", "agent-1", "lsp", "s1", valid},
		{"лишняя часть", secret, vectorToken + ".extra", "agent-1", "lsp", "s1", valid},
		{"не base64", secret, "!!!.???", "agent-1", "lsp", "s1", valid},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := verifyToken(tc.secret, tc.token, tc.aud, tc.scope, tc.sid, tc.now); err == nil {
				t.Fatal("токен должен быть отклонён")
			}
		})
	}
}

func TestUsedTicketsAcceptEachOnce(t *testing.T) {
	u := newUsedTickets()
	now := time.Unix(1000, 0)

	if !u.markUsed("a", 2000, now) {
		t.Fatal("первое использование должно проходить")
	}
	if u.markUsed("a", 2000, now) {
		t.Fatal("повторное использование должно отклоняться")
	}
	if !u.markUsed("b", 2000, now) {
		t.Fatal("другой билет должен проходить")
	}

	// После истечения срока запись очищается.
	later := time.Unix(2001, 0)
	if !u.markUsed("a", 3000, later) {
		t.Fatal("после очистки номер можно использовать снова")
	}
}

func TestReapRemovesSessionsPastMaxLifetime(t *testing.T) {
	h, cfg := newTestHandler(t)
	cfg.SessionMax = time.Hour
	createSession(t, h, "s1")
	createSession(t, h, "s2")

	// s1 создана давно, но активна: абсолютный срок всё равно её удаляет.
	h.Manager.mu.Lock()
	h.Manager.sessions["s1"].Created = time.Now().Add(-2 * time.Hour)
	h.Manager.mu.Unlock()

	if n := h.Manager.Reap(); n != 1 {
		t.Fatalf("удалено сессий: %d, ожидали 1", n)
	}

	public := h.PublicRoutes()
	expectStatus(t, do(public, "GET", "/sessions/s1", "", bearer(filesToken("s1"))), 404, "session_not_found")
	expectStatus(t, do(public, "GET", "/sessions/s2", "", bearer(filesToken("s2"))), 200, "")
}

func TestReapIgnoresMaxLifetimeWhenDisabled(t *testing.T) {
	h, cfg := newTestHandler(t)
	cfg.SessionMax = 0
	createSession(t, h, "s1")

	h.Manager.mu.Lock()
	h.Manager.sessions["s1"].Created = time.Now().Add(-100 * time.Hour)
	h.Manager.mu.Unlock()

	if n := h.Manager.Reap(); n != 0 {
		t.Fatalf("удалено сессий: %d, ожидали 0", n)
	}
}
