package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
)

// Ошибки API. Тело ответа: {"error": "<код>", "message": "<текст>"}.
type apiError struct {
	Status  int    `json:"-"`
	Code    string `json:"error"`
	Message string `json:"message"`
}

func (e *apiError) Error() string { return e.Message }

func newAPIError(status int, code, format string, args ...any) *apiError {
	return &apiError{
		Status:  status,
		Code:    code,
		Message: fmt.Sprintf(format, args...),
	}
}

func invalidPath(format string, args ...any) *apiError {
	return newAPIError(400, "invalid_path", format, args...)
}

var errUnauthorized = newAPIError(http.StatusUnauthorized, "unauthorized", "Недействительный или просроченный токен")

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeAPIError принимает любую ошибку: *apiError уходит клиенту как есть,
// всё остальное логируется и превращается в 500.
func writeAPIError(w http.ResponseWriter, err error) {
	var apiErr *apiError
	if errors.As(err, &apiErr) {
		writeJSON(w, apiErr.Status, apiErr)
		return
	}

	log.Printf("[Agent] internal error: %v", err)
	writeJSON(w, http.StatusInternalServerError, &apiError{Code: "internal", Message: "Внутренняя ошибка агента"})
}
