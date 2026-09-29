import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./supabase/functions/api/shared", import.meta.url)) },
  },
  test: { include: ["apps/**/src/**/*.test.ts"] },
});
