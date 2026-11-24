package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

type IssuedToken struct {
	Token            string `json:"token"`
	ExpiresInSeconds int64  `json:"expiresInSeconds"`
}

type payload struct {
	SessionID string `json:"sid"`
	Scope     string `json:"scope"`
	ExpiresAt int64  `json:"exp"`
	TokenID   string `json:"jti"`
	Audience  string `json:"aud"`
}

type TokenService struct {
	secret  []byte
	agentID string
}

func NewTokenService(secret, agentID string) (*TokenService, error) {
	if len(secret) < 32 {
		return nil, errors.New("token secret must be at least 32 bytes")
	}
	if strings.TrimSpace(agentID) == "" {
		return nil, errors.New("agent ID must not be blank")
	}
	return &TokenService{secret: []byte(secret), agentID: agentID}, nil
}

func (s *TokenService) IssueFilesToken(sessionID string) (IssuedToken, error) {
	return s.issue(sessionID, "files", 15*time.Minute)
}

func (s *TokenService) IssueLSPTicket(sessionID string) (IssuedToken, error) {
	return s.issue(sessionID, "lsp", 60*time.Second)
}

func (s *TokenService) issue(sessionID, scope string, ttl time.Duration) (IssuedToken, error) {
	if strings.TrimSpace(sessionID) == "" {
		return IssuedToken{}, errors.New("session ID must not be blank")
	}
	if scope != "files" && scope != "lsp" {
		return IssuedToken{}, errors.New("unsupported token scope")
	}
	if ttl <= 0 {
		return IssuedToken{}, errors.New("TTL must be positive")
	}

	expiresIn := int64(ttl.Seconds())
	data, err := json.Marshal(payload{
		SessionID: sessionID,
		Scope:     scope,
		ExpiresAt: time.Now().Add(ttl).Unix(),
		TokenID:   uuid.NewString(),
		Audience:  s.agentID,
	})
	if err != nil {
		return IssuedToken{}, err
	}

	payloadPart := base64.RawURLEncoding.EncodeToString(data)

	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(payloadPart))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return IssuedToken{
		Token:            payloadPart + "." + signature,
		ExpiresInSeconds: expiresIn,
	}, nil
}
