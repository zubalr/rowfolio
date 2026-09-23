import { defineConfig } from "@playwright/test";

/**
 * E2E harness configuration. The suite itself lands with the test-authoring
 * tasks under tests/e2e/; until then `pnpm test:e2e` exits 0 via
 * --pass-with-no-tests so the script contract is satisfiable from day one.
 *
 * Suites should serve `apps/web/dist` (built by `pnpm build`) rather than the
 * dev server so that tests exercise the exact static artifact that ships.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.ROWFOLIO_E2E_BASE_URL ?? "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
});
