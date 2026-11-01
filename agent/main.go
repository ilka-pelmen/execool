package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
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

	public := &http.Server{
		Addr:              ":" + cfg.AgentPort,
		Handler:           handler.PublicRoutes(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	internal := &http.Server{
		Addr:              cfg.InternalAddr,
		Handler:           handler.InternalRoutes(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 2)
	serve := func(name string, server *http.Server) {
		go func() {
			log.Printf("[Agent] %s API on %s", name, server.Addr)
			if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				errCh <- fmt.Errorf("%s server failed: %w", name, err)
			}
		}()
	}
	serve("public", public)
	serve("internal", internal)

	select {
	case <-ctx.Done():
		log.Println("[Agent] Shutting down...")
	case err := <-errCh:
		log.Printf("[Agent] %v", err)
	}

	stop() // отменяет контекст: подключения языкового сервера закрываются

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for _, server := range []*http.Server{public, internal} {
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
		}
	}

	lsp.Wait(5 * time.Second)
	manager.Shutdown()
	log.Println("[Agent] Goodbye.")
}
