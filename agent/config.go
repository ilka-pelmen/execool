package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type Config struct {
	BaseImage       string
	ContainerPrefix string
	BaseSessionsDir string
	AgentPort       string

	//  Лимиты использования
	ExecTimeout time.Duration
	MaxOutput   int
	MaxUpload   int64
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
	if err != nil || d < time.Second { // меньше секунды нельзя: timeout 0 = без лимита
		log.Printf("[Config] bad %s=%q, using %s", key, v, def)
		return def
	}
	return d
}

func LoadConfig() Config {
	port := flag.String("port", getenv("AGENT_PORT", "6721"), "Port to listen on")
	flag.Parse()

	return Config{
		BaseImage:       getenv("AGENT_BASE_IMAGE", "docker.io/library/python:3.11-alpine"),
		ContainerPrefix: "execool-",
		BaseSessionsDir: filepath.Join(os.TempDir(), "execool-sessions"),
		AgentPort:       *port,

		ExecTimeout: getenvDuration("AGENT_EXEC_TIMEOUT", 30*time.Second),
		MaxOutput:   getenvInt("AGENT_MAX_OUTPUT", 1<<20),
		MaxUpload:   int64(getenvInt("AGENT_MAX_UPLOAD", 10<<20)),
	}
}
