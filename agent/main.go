package main

import (
	"fmt"
	"net/http"
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
	mux.HandleFunc("Get /session/{sessionId}/files", runner.ListFilesEndpoint)

	addr := ":" + cfg.AgentPort
	fmt.Printf("[Agent] Starting on http://localhost%s...\n", addr)

	if err := http.ListenAndServe(addr, mux); err != nil {
		fmt.Printf("[Agent Critical] Server failed: %v\n", err)
	}
}
