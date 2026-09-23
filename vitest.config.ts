import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "scripts/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.tsx",
      "apps/web/src/**/*.test.ts",
      "apps/web/src/**/*.test.tsx",
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
    ],
    environment: "node",
    testTimeout: 120_000,
  },
});
