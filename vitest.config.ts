import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "__tests__/components/**/*.test.{ts,tsx}",
      "__tests__/hooks/**/*.test.ts",
      "__tests__/app/**/*.test.ts",
      "__tests__/lib/recent-cwds-storage.test.ts",
    ],
    clearMocks: true,
    restoreMocks: true,
  },
});
