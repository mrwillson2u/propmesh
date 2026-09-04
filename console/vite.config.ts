import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build target is an SPA embedded in the bridge node's flash — keep the
// bundle lean and gzip-friendly. Dev proxy will point at a real bridge
// (propmesh.local) once the WS API exists.
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 700 },
});
