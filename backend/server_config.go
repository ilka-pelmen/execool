//go:build deploy

package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
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

	etags, err := buildETags(webRoot)
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
		c.Header("Cross-Origin-Opener-Policy", "same-origin")
		c.Header("Cross-Origin-Embedder-Policy", "require-corp")
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

		etag := etags[name]
		c.Header("ETag", etag)
		if strings.HasPrefix(name, "assets/") {
			c.Header("Cache-Control", "public, max-age=604800, immutable")
		} else {
			c.Header("Cache-Control", "no-cache")
			if c.GetHeader("If-None-Match") == etag {
				c.Status(http.StatusNotModified)
				return
			}
		}
		c.FileFromFS(name, http.FS(webRoot))
	})

	return nil
}

func buildETags(fsys fs.FS) (map[string]string, error) {
	etags := make(map[string]string)
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		etags[p] = `"` + hex.EncodeToString(sum[:16]) + `"`
		return nil
	})
	return etags, err
}
