package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	cfg := LoadConfig()
	runner := SessionRunner{Conf: cfg}

	runner.RemoveAllContainers()
	if err := os.RemoveAll(cfg.BaseSessionsDir); err != nil {
		log.Printf("[Agent] cleanup: %v", err)
	}
	if err := os.MkdirAll(cfg.BaseSessionsDir, 0700); err != nil {
		log.Fatalf("[Agent] cannot create sessions dir: %v", err)
	}
	if err := runner.InitializeBaseImage(); err != nil {
		log.Fatalf("[Agent] %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /session/start", runner.StartEndpoint)
	mux.HandleFunc("POST /session/{sessionId}/run", runner.ExecEndpoint)
	mux.HandleFunc("DELETE /session/{sessionId}", runner.DeleteEndpoint)

	mux.HandleFunc("PUT /session/{sessionId}/file", runner.PutFileEndpoint)
	mux.HandleFunc("DELETE /session/{sessionId}/file", runner.DeleteFileEndpoint)
	mux.HandleFunc("GET /session/{sessionId}/file", runner.GetFileEndpoint)
	mux.HandleFunc("GET /session/{sessionId}/files", runner.ListFilesEndpoint)

	mux.HandleFunc("POST /lint", LintEndpoint)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	addr := ":" + cfg.AgentPort
	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	go func() {
		log.Printf("[Agent] Starting on http://localhost%s...\n", addr)

		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("[Agent Critical] Server failed: %v\n", err)
		}
	}()

	sig := <-sigChan
	log.Printf("[Agent] Got signal %v. Shutting down...\n", sig)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		_ = server.Close() // время вышло: рвём оставшиеся соединения
	}

	runner.RemoveAllContainers()

	if err := os.RemoveAll(cfg.BaseSessionsDir); err != nil {
		log.Printf("[Agent Critical] Error deleting the runtime directory %s: %v\n", cfg.BaseSessionsDir, err)
	} else {
		log.Printf("[Agent] Runtime directory %s removed.\n", cfg.BaseSessionsDir)
	}

	log.Println("[Agent] Goodbye.")
}
