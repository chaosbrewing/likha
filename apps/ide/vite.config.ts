import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    target: "chrome130",
    chunkSizeWarningLimit: 8000
  },
  worker: {
    format: "es"
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  }
});
