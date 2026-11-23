//go:build !deploy

package main

import (
	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.DebugMode)
}

func staticResourceConfig(_ *gin.Engine) error {
	return nil
}
