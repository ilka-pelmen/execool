package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const defaultLanguage = "python"

type LSPInfo struct {
	WebSocketURL     string `json:"websocket_url"`
	Ticket           string `json:"ticket"`
	ExpiresInSeconds int64  `json:"expires_in_seconds"`
}

type StartLSPRequest struct {
	LanguageID string `json:"language_id"`
}

type StartLSPResponse struct {
	SessionID              string      `json:"session_id"`
	Language               string      `json:"language"`
	RootURI                string      `json:"root_uri"`
	Limits                 AgentLimits `json:"limits"`
	AgentPublicURL         string      `json:"agent_url"`
	FilesToken             string      `json:"files_token"`
	FilesTokenExpiresInSec int64       `json:"files_token_expires_in_seconds"`
	LSP                    LSPInfo     `json:"lsp"`
}

type SessionController struct {
	workspace      *SessionWorkspace
	tokenService   *TokenService
	agentPublicURL string
}

func NewSessionController(config Config) (*SessionController, error) {
	tokenService, err := NewTokenService(config.AgentTokenSecret, config.AgentID)

	if err != nil {
		return nil, err
	}

	return &SessionController{
		workspace:      NewSessionWorkspace(config.AgentInternalUrl, config.AgentAPIKey),
		tokenService:   tokenService,
		agentPublicURL: strings.TrimRight(config.AgentURL, "/"),
	}, nil
}

// POST: /api/sessions/start-lsp
func (s *SessionController) StartLSP(c *gin.Context) {
	var request StartLSPRequest
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&request); err != nil && !errors.Is(err, io.EOF) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
			return
		}
	}

	language := strings.TrimSpace(request.LanguageID)
	if language == "" {
		language = defaultLanguage
	}

	id, err := uuid.NewRandom()

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Session UUID generation error"})
		return
	}

	session, err := s.workspace.CreateSession(c.Request.Context(), id.String(), language)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Session creation error"})
		return
	}

	token, err := s.tokenService.IssueFilesToken(id.String())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Session file_token generation error"})
		return
	}

	lspInfo, err := s.buildLSPInfo(session.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Session LSPInfo creation error"})
		return
	}

	c.JSON(http.StatusCreated, StartLSPResponse{
		SessionID:              session.ID,
		Language:               session.Language,
		RootURI:                session.RootURI,
		Limits:                 session.Limits,
		AgentPublicURL:         s.agentPublicURL,
		FilesToken:             token.Token,
		FilesTokenExpiresInSec: token.ExpiresInSeconds,
		LSP:                    lspInfo,
	})
}

// POST: /api/sessions/:id/lsp-ticket
func (s *SessionController) RenewLSPTicket(c *gin.Context) {
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request", "message": "Invalid ID passed"})
	}

	lspInfo, err := s.buildLSPInfo(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed", "message": "Could not renew LSP ticket"})
	}

	c.JSON(http.StatusOK, lspInfo)
}

// POST: /api/sessions/:id/files-token
func (s *SessionController) RenewFilesToken(c *gin.Context) {
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request", "message": "Invalid ID passed"})
		return
	}

	token, err := s.tokenService.IssueFilesToken(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed", "message": "Could not renew files token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"files_token":                    token.Token,
		"files_token_expires_in_seconds": token.ExpiresInSeconds,
	})
}

// DELETE: /api/sessions/:id
func (s *SessionController) DeleteSession(c *gin.Context) {
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request", "message": "Invalid ID passed"})
		return
	}

	if err := s.workspace.DeleteSession(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed", "message": "Failed to delete session"})
		return
	}

	c.Status(http.StatusNoContent)
}

// Internal
func (s *SessionController) buildLSPInfo(sessionID string) (LSPInfo, error) {
	ticket, err := s.tokenService.IssueLSPTicket(sessionID)
	if err != nil {
		return LSPInfo{}, err
	}

	u, err := url.Parse(s.agentPublicURL)
	if err != nil {
		return LSPInfo{}, fmt.Errorf("Parse agent public URL: %w", err)
	}

	switch strings.ToLower(u.Scheme) {
	case "https":
		u.Scheme = "wss"
	default:
		u.Scheme = "ws"
	}

	u = u.JoinPath("sessions", sessionID, "lsp")

	query := u.Query()
	query.Set("ticket", ticket.Token)
	u.RawQuery = query.Encode()

	return LSPInfo{
		WebSocketURL:     u.String(),
		Ticket:           ticket.Token,
		ExpiresInSeconds: ticket.ExpiresInSeconds,
	}, nil
}
