package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"
)

// Формат токена: base64url(JSON) + "." + base64url(HMAC-SHA256(секрет, base64url(JSON))),
// base64url без дополняющих символов "=". Токены выпускает Spring, агент их проверяет.
//
// Поля JSON:
//
//	sid   идентификатор сессии
//	scope "files" (HTTP-запросы к файлам) или "lsp" (одноразовый билет WebSocket)
//	exp   срок действия, секунды Unix
//	jti   уникальный номер токена
//	aud   идентификатор агента (AGENT_ID)
const (
	scopeFiles = "files"
	scopeLSP   = "lsp"
)

type claims struct {
	SID   string `json:"sid"`
	Scope string `json:"scope"`
	Exp   int64  `json:"exp"`
	JTI   string `json:"jti"`
	Aud   string `json:"aud"`
}

var errInvalidToken = errors.New("invalid token")

// verifyAgentAPIKey проверяет внутренний Bearer-ключ Spring -> агент.
func verifyAgentAPIKey(configuredKey, authorizationHeader string) bool {
	if configuredKey == "" {
		return false
	}

	fields := strings.Fields(authorizationHeader)
	if len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") {
		return false
	}

	return hmac.Equal([]byte(configuredKey), []byte(fields[1]))
}

// verifyToken проверяет подпись, назначение, агента, сессию и срок действия. Browser -> агент
func verifyToken(secret []byte, token, audience, scope, sessionID string, now time.Time) (claims, error) {
	payloadPart, sigPart, ok := strings.Cut(token, ".")
	if !ok || payloadPart == "" || sigPart == "" || strings.Contains(sigPart, ".") {
		return claims{}, errInvalidToken
	}
	sig, err := base64.RawURLEncoding.DecodeString(sigPart)
	if err != nil {
		return claims{}, errInvalidToken
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payloadPart))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return claims{}, errInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(payloadPart)
	if err != nil {
		return claims{}, errInvalidToken
	}
	var c claims
	if err := json.Unmarshal(payload, &c); err != nil {
		return claims{}, errInvalidToken
	}
	if c.Aud != audience || c.Scope != scope || c.SID != sessionID || c.JTI == "" || now.Unix() >= c.Exp {
		return claims{}, errInvalidToken
	}
	return c, nil
}

// usedTickets помнит билеты WebSocket до истечения срока, чтобы принимать каждый только раз.
type usedTickets struct {
	mu   sync.Mutex
	seen map[string]int64 // jti -> срок действия
}

func newUsedTickets() *usedTickets {
	return &usedTickets{seen: make(map[string]int64)}
}

// markUsed возвращает false, если билет уже использовался.
func (u *usedTickets) markUsed(jti string, exp int64, now time.Time) bool {
	u.mu.Lock()
	defer u.mu.Unlock()

	nowUnix := now.Unix()
	if jti == "" || exp <= nowUnix {
		return false
	}

	for id, e := range u.seen {
		if e <= nowUnix {
			delete(u.seen, id)
		}
	}

	if _, used := u.seen[jti]; used {
		return false
	}
	u.seen[jti] = exp
	return true
}
