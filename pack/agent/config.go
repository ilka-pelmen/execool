package main

import (
	"encoding/json"
	"flag"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AgentPort      string
	InternalAddr   string              // адрес внутреннего API (для Spring), по умолчанию только localhost
	AgentID        string              // значение поля aud в токенах: токен действует только на этом агенте
	APIKey         string              // ключ внутреннего API (вызовы от Spring)
	TokenSecret    []byte              // секрет подписи токенов (общий со Spring)
	LSPCommands    map[string][]string // команда запуска языкового сервера
	AllowedOrigins []string            // шаблоны полных Origin: http://localhost:*, https://app.example.com
	WorkspaceRoot  string              // здесь создаются рабочие папки сессий
	MaxSessions    int                 // сессий на агенте
	MaxLSP         int                 // одновременных процессов языкового сервера
	SessionIdle    time.Duration       // сессия без активности удаляется
	LSPIdle        time.Duration       // подключение без сообщений закрывается
	Limits         Limits              // квоты одной сессии
	MaxMessageSize int64               // максимальный размер сообщения LSP, байт
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		log.Printf("[Config] bad %s=%q, using %d", key, v, def)
		return def
	}
	return n
}

func getenvDuration(key string, def time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		log.Printf("[Config] bad %s=%q, using %s", key, v, def)
		return def
	}
	return d
}

func splitList(s string) []string {
	var items []string
	for _, item := range strings.Split(s, ",") {
		if item = strings.TrimSpace(item); item != "" {
			items = append(items, item)
		}
	}
	return items
}

func LoadConfig() Config {
	port := flag.String("port", getenv("AGENT_PORT", "6721"), "Port to listen on")
	flag.Parse()

	apiKey := os.Getenv("AGENT_API_KEY")
	secret := os.Getenv("AGENT_TOKEN_SECRET")
	if len(apiKey) < 16 {
		log.Fatal("[Config] AGENT_API_KEY is required (at least 16 characters)")
	}
	if len(secret) < 32 {
		log.Fatal("[Config] AGENT_TOKEN_SECRET is required (at least 32 characters)")
	}

	raw_commands := getenv("AGENT_LSP_COMMANDS", `{"python":["pyrefly","lsp"]}`)

	var commands map[string][]string
	if err := json.Unmarshal([]byte(raw_commands), &commands); err != nil {
		log.Fatalf("[Config] bad AGENT_LSP_COMMANDS: %v", err)
	}

	root, err := filepath.Abs(getenv("AGENT_WORKSPACE_DIR", filepath.Join(os.TempDir(), "execool-lsp")))
	if err != nil {
		log.Fatalf("[Config] bad AGENT_WORKSPACE_DIR: %v", err)
	}

	return Config{
		AgentPort:      *port,
		InternalAddr:   getenv("AGENT_INTERNAL_ADDR", "127.0.0.1:6722"),
		AgentID:        getenv("AGENT_ID", "agent-1"),
		APIKey:         apiKey,
		TokenSecret:    []byte(secret),
		LSPCommands:    commands,
		AllowedOrigins: splitList(getenv("AGENT_ALLOWED_ORIGINS", "http://localhost:*,http://127.0.0.1:*")),
		WorkspaceRoot:  root,
		MaxSessions:    getenvInt("AGENT_MAX_SESSIONS", 50),
		MaxLSP:         getenvInt("AGENT_MAX_LSP", 4),
		SessionIdle:    getenvDuration("AGENT_SESSION_IDLE", 10*time.Minute),
		LSPIdle:        getenvDuration("AGENT_LSP_IDLE", 5*time.Minute),
		Limits: Limits{
			MaxFiles:      getenvInt("AGENT_MAX_FILES", 100),
			MaxFileBytes:  int64(getenvInt("AGENT_MAX_FILE_BYTES", 1<<20)),
			MaxTotalBytes: int64(getenvInt("AGENT_MAX_TOTAL_BYTES", 5<<20)),
		},
		MaxMessageSize: int64(getenvInt("AGENT_MAX_MESSAGE", 2<<20)),
	}
}

// originHostPatterns превращает шаблоны Origin в шаблоны хостов для проверки WebSocket.
func (c Config) originHostPatterns() []string {
	patterns := make([]string, 0, len(c.AllowedOrigins))
	for _, origin := range c.AllowedOrigins {
		if _, host, found := strings.Cut(origin, "://"); found {
			patterns = append(patterns, host)
		} else {
			patterns = append(patterns, origin)
		}
	}
	return patterns
}
