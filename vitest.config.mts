import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Phase A — sanity 위주 (node 환경).
 * Phase B 진입 시 component 테스트 추가하면 @vitejs/plugin-react + happy-dom 환경 활성화.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.{ts,tsx}",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
    },
  },
});
