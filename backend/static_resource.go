//go:build deploy

package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed static/assets
var staticAssets embed.FS

func staticResourceConfig(g *gin.Engine) error {
	assets, err := fs.Sub(staticAssets, "static/assets")
	if err != nil {
		return err
	}

	g.Use(func(ctx *gin.Context) {
		if strings.HasPrefix(ctx.Request.URL.Path, "/assets/") {
			ctx.Header("Cache-Control", "public, max-age=31536000")
		}

		ctx.Next()
	})

	g.StaticFS("/assets", http.FS(assets))
	return nil
}
