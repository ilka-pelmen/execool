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

	apiGroup := router.Group("/api")
	apiGroup.Use(cors.New(cors.Config{
		AllowOrigins:     config.AllowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE"},
		AllowHeaders:     []string{"*"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	router.GET("/ping", func(c *gin.Context) {
		c.String(http.StatusOK, "pong")
	})
	staticResourceConfig(router)

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
