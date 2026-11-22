package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"time"
)

type AgentLimits struct {
	MaxFiles      int64 `json:"maxFiles"`
	MaxFileBytes  int64 `json:"maxFileBytes"`
	MaxTotalBytes int64 `json:"maxTotalBytes"`
}

type AgentSession struct {
	ID       string      `json:"id"`
	Language string      `json:"language"`
	RootURI  string      `json:"rootUri"`
	Limits   AgentLimits `json:"limits"`
}

type SessionWorkspace struct {
	client           *http.Client
	agentInternalURL string
	agentAPIKey      string
}

type createSessionRequest struct {
	ID       string `json:"id"`
	Language string `json:"language"`
}

func NewSessionWorkspace(internalUrl string, apiKey string) *SessionWorkspace {
	return &SessionWorkspace{
		client:           createWorkspaceClient(),
		agentInternalURL: internalUrl,
		agentAPIKey:      apiKey,
	}
}

func (s *SessionWorkspace) CreateSession(ctx context.Context, sessionID string, languageID string) (AgentSession, error) {
	createRequest := createSessionRequest{
		ID:       sessionID,
		Language: languageID,
	}

	body, err := json.Marshal(createRequest)
	if err != nil {
		return AgentSession{}, err
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		s.agentInternalURL+"/internal/sessions",
		bytes.NewReader(body),
	)

	if err != nil {
		return AgentSession{}, err
	}

	s.setHeaders(req)

	resp, err := s.client.Do(req)
	if err != nil {
		return AgentSession{}, fmt.Errorf("[CreateSession] Failed to call agent: %w", err)
	}

	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return AgentSession{}, fmt.Errorf("[CreateSession] Agent returned HTTP response: %s", resp.Status)
	}

	var session AgentSession
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
		return AgentSession{}, fmt.Errorf("[CreateSession] Failed to decode agent response")
	}

	return session, nil
}

func (s *SessionWorkspace) DeleteSession(ctx context.Context, sessionID string) error {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodDelete,
		s.agentInternalURL+"/internal/sessions/"+sessionID,
		nil,
	)

	if err != nil {
		return err
	}

	s.setHeaders(req)
	resp, err := s.client.Do(req)

	if err != nil {
		return fmt.Errorf("[DeleteSession] Failed to call agent: %w", err)
	}

	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("[DeleteSession] agent returned HTTP response: %s", resp.Status)
	}

	return nil
}

func createWorkspaceClient() *http.Client {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: 2 * time.Second,
		}).DialContext,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
	}
}

func (s *SessionWorkspace) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+s.agentAPIKey)
	req.Header.Set("Content-Type", "application/json")
}
