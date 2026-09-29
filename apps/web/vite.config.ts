import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../../supabase/functions/api/shared", import.meta.url)),
    },
  },
  server: { port: 5173 },
  build: { sourcemap: false },
});
