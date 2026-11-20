import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  esbuild: { jsx: "automatic" }, // tsconfig uses "preserve" for Next; tests need JSX compiled
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "src/test/server-only.ts") } },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
