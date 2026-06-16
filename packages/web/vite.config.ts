import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev proxies the orchestrator API (default :8080). Override with VITE_API_BASE.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/research": "http://localhost:8080",
      "/health": "http://localhost:8080",
    },
  },
});
