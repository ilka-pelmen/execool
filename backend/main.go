package main

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	config := LoadConfig()
	router := gin.New()

	router.Use(gin.Logger())
	router.Use(gin.Recovery())

	corsHandler := cors.New(cors.Config{
		AllowOrigins:     config.AllowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	})

	router.Use(func(c *gin.Context) {
		c.Header("Cross-Origin-Opener-Policy", "same-origin")
		c.Header("Cross-Origin-Embedder-Policy", "require-corp")
		c.Next()
	})

	apiGroup := router.Group("/api")
	apiGroup.Use(corsHandler)

	router.GET("/ping", corsHandler, func(c *gin.Context) {
		c.String(http.StatusOK, "pong")
	})

	err := staticResourceConfig(router)
	if err != nil {
		log.Fatalf("create session controller: %v", err)
		return
	}

	sc, err := NewSessionController(config)
	if err != nil {
		log.Fatalf("create session controller: %v", err)
		return
	}

	api := router.Group("/api/sessions")
	api.POST("/start-lsp", sc.StartLSP)
	api.POST("/:id/lsp-ticket", sc.RenewLSPTicket)
	api.POST("/:id/files-token", sc.RenewFilesToken)
	api.DELETE("/:id", sc.DeleteSession)

	router.SetTrustedProxies(nil)
	router.Run(":" + config.Port)
}
