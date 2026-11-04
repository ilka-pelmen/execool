package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func main() {
	cfg := LoadConfig()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	manager := NewSessionManager(&cfg)
	if err := manager.Start(); err != nil {
		log.Fatalf("[Agent] cannot prepare workspace %s: %v", cfg.WorkspaceRoot, err)
	}

	lsp := NewLSPHost(ctx, &cfg)
	handler := NewWebHandler(&cfg, manager, lsp)

	go manager.RunReaper(ctx)

	internalMux := handler.InternalRoutes()
	publicMux := handler.PublicRoutes()

	server := &http.Server{
		Addr: ":" + cfg.AgentPort,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/internal" || strings.HasPrefix(r.URL.Path, "/internal/") {
				http.StripPrefix("/internal", internalMux).ServeHTTP(w, r)
				return
			}
			publicMux.ServeHTTP(w, r)
		}),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 2)
	go func() {
		log.Printf("[Agent] Server API on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("Server failed: %w", err)
		}
	}()

	select {
	case <-ctx.Done():
		log.Println("[Agent] Shutting down...")
	case err := <-errCh:
		log.Printf("[Agent] %v", err)
	}

	stop() // отменяет контекст: подключения языкового сервера закрываются

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		_ = server.Close()
	}

	lsp.Wait(5 * time.Second)
	manager.Shutdown()
	log.Println("[Agent] Goodbye.")
}
