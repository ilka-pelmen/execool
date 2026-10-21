package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os/exec"
	"time"
)

const (
	lintTimeout = 10 * time.Second
	maxLintBody = 1 << 20 // 1 MiB кода
)

// POST /lint: тело запроса это исходный код Python, ответ это JSON от ruff.
func LintEndpoint(w http.ResponseWriter, r *http.Request) {
	code, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxLintBody))
	if err != nil {
		http.Error(w, "Request body too large", http.StatusRequestEntityTooLarge)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), lintTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ruff", "check",
		"--isolated",
		"--output-format", "json",
		"--stdin-filename", "main.py",
		"-")
	cmd.Stdin = bytes.NewReader(code)

	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr

	// Код выхода 1 означает «замечания найдены», это не сбой.
	// Настоящая ошибка (код 2, таймаут, нет бинарника) отличается от него.
	err = cmd.Run()
	var exitErr *exec.ExitError
	if err != nil && !(errors.As(err, &exitErr) && exitErr.ExitCode() == 1) {
		log.Printf("ruff failed: %v: %s", err, stderr.String())
		http.Error(w, "Lint failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(stdout.Bytes())
}
