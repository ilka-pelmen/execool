package main

import (
	"log"
	"os"
	"strings"
)

type Config struct {
	Port             string
	AllowedOrigins   []string
	AgentURL         string
	AgentInternalUrl string
	AgentAPIKey      string
	AgentTokenSecret string
	AgentID          string
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
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
	apiKey := os.Getenv("AGENT_API_KEY")
	secret := os.Getenv("AGENT_TOKEN_SECRET")
	agentID, agentIDSet := os.LookupEnv("AGENT_ID")
	if len(apiKey) < 16 {
		log.Fatal("[Config] AGENT_API_KEY is required (at least 16 characters)")
	}
	if len(secret) < 32 {
		log.Fatal("[Config] AGENT_TOKEN_SECRET is required (at least 32 characters)")
	}
	if !agentIDSet {
		log.Fatal("[Config] AGENT_ID is required")
	}

	agentPublicUrl := getenv("AGENT_PUBLIC_URL", "http://localhost:6721")
	return Config{
		Port:             getenv("SERVER_PORT", "6767"),
		AllowedOrigins:   splitList(getenv("APP_CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")),
		AgentURL:         agentPublicUrl,
		AgentInternalUrl: getenv("AGENT_INTERNAL_URL", agentPublicUrl),
		AgentAPIKey:      apiKey,
		AgentTokenSecret: secret,
		AgentID:          agentID,
	}
}
