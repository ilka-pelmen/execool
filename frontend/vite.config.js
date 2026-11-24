
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Интерактивный ввод (input()) держится на SharedArrayBuffer, а он доступен только
// на странице с cross-origin isolation. Эти же заголовки нужно отдавать и в продакшене
// (для Netlify / Cloudflare Pages они лежат в public/_headers).
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [
    preact(),
    {
      name: "cross-origin-isolation",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          for (const [k, v] of Object.entries(isolationHeaders))
            res.setHeader(k, v);
          next();
        });
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: /^react$/,
        replacement: "preact/compat",
      },
      {
        find: /^react-dom$/,
        replacement: "preact/compat",
      },
      {
        find: /^react-dom\/test-utils$/,
        replacement: "preact/test-utils",
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: "preact/jsx-runtime",
      },
    ],
  },
  preview: {
    headers: isolationHeaders,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:6767",
        changeOrigin: true,
      },
    },
  },
});
