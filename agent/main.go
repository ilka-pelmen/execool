package main

import (
	"context"
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

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	addr := ":" + cfg.AgentPort
	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	go func() {
		log.Printf("[Agent] Starting on http://localhost%s...\n", addr)

		if err := server.ListenAndServe(); err != nil {
			log.Fatalf("[Agent Critical] Server failed: %v\n", err)
		}
	}()

	sig := <-sigChan
	log.Printf("[Agent] Got signal %v. Shutting down...\n", sig)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = server.Shutdown(ctx)

	err := os.RemoveAll(cfg.BaseSessionsDir)
	if err != nil {
		log.Fatalf("[Agent Critical] Error deleting the runtime directory %s: %v\n", cfg.BaseSessionsDir, err)
	} else {
		log.Printf("[Agent] Runtime directory %s removed.\n", cfg.BaseSessionsDir)
	}

	log.Println("[Agent] Goodbye.")
}
