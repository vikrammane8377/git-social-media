import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the @bix/server (default port 8787) so the SPA and
// API share an origin during development. In production the server serves the
// built SPA itself, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
