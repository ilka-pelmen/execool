//go:build deploy

package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed static
var staticFiles embed.FS

func init() {
	gin.SetMode(gin.ReleaseMode)
}

func staticResourceConfig(g *gin.Engine) error {
	webRoot, err := fs.Sub(staticFiles, "static")
	if err != nil {
		return err
	}

	indexHTML, err := fs.ReadFile(webRoot, "index.html")
	if err != nil {
		return fmt.Errorf("index.html not embedded: %w", err)
	}

	// index.html is revalidated on every load, like the Spring setup
	g.GET("/", func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache")
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
	})

	// Files under assets/ are hashed and cached for a week; the rest is revalidated.
	g.NoRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.Status(http.StatusNotFound)
			return
		}
		name := strings.TrimPrefix(c.Request.URL.Path, "/")
		info, err := fs.Stat(webRoot, name)
		if err != nil || info.IsDir() {
			c.Status(http.StatusNotFound)
			return
		}
		if strings.HasPrefix(name, "assets/") {
			c.Header("Cache-Control", "public, max-age=604800, immutable")
		} else {
			c.Header("Cache-Control", "no-cache")
		}
		c.FileFromFS(name, http.FS(webRoot))
	})

	return nil
}
