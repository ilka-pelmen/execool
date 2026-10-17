package main

import (
	"path/filepath"
	"flag"
	"os"
)

type Config struct {
	BaseImage       string
	ContainerPrefix string
	BaseSessionsDir string
	AgentPort       string
}

func LoadConfig() Config {
	sessionsRoot := filepath.Join(os.TempDir(), "execool-sessions")
	_ = os.MkdirAll(sessionsRoot, 0755)

	port := os.Getenv("AGENT_PORT")
	if port == "" {
		port = "6721"
	}

	portFlag := flag.String("port", port, "Port to listen on")
	flag.Parse()

	return Config{
		BaseImage:       "python:3.11-alpine",
		ContainerPrefix: "execool-",
		BaseSessionsDir: sessionsRoot,
		AgentPort:       *portFlag,
	}
}
