import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build target is an SPA embedded in the bridge node's flash — keep the
// bundle lean and gzip-friendly. Dev proxy will point at a real bridge
// (propmesh.local) once the WS API exists.
// Relative asset paths: the same dist/ serves from the bridge's root,
// from the docs site under /propmesh/try/, or inside a native shell.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { chunkSizeWarningLimit: 700 },
});
