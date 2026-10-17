
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
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
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:6767",
        changeOrigin: true,
      },
    },
  },
});
