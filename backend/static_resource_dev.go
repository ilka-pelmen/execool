//go:build !deploy

package main

import (
	"github.com/gin-gonic/gin"
)

func staticResourceConfig(_ *gin.Engine) error {
	return nil
}
