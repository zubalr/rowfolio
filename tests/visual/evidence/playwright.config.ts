import { defineConfig } from "@playwright/test";

/**
 * Visual/a11y harness for apps/web/src/evidence (owned path
 * tests/visual/evidence). Mirrors tests/visual/ui: the webServer builds the
 * harness (`vite build`) and serves the static artifact via `vite preview` —
 * tests never touch a dev server.
 *
 * Artifacts land in tests/visual/evidence/artifacts/ — generated evidence,
 * never committed. Run:
 *   pnpm exec playwright test --config tests/visual/evidence/playwright.config.ts
 */
export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "./test-results",
  timeout: 60_000,
  use: {
    baseURL: process.env.ROWFOLIO_EVIDENCE_BASE_URL ?? "http://127.0.0.1:4532",
    trace: "on-first-retry",
    screenshot: "off",
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
  projects: [
    {
      name: "desktop-en",
      use: { viewport: { width: 1440, height: 900 }, locale: "en-US" },
      testMatch: /\.spec\.ts$/,
    },
    {
      name: "desktop-ar",
      use: { viewport: { width: 1440, height: 900 }, locale: "ar-QA" },
      testMatch: /\.spec\.ts$/,
    },
    {
      name: "mobile-en",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      testMatch: /\.spec\.ts$/,
    },
    {
      name: "mobile-ar",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "ar-QA",
      },
      testMatch: /\.spec\.ts$/,
    },
    {
      name: "narrow-320",
      use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true },
      testMatch: /\.spec\.ts$/,
    },
  ],
  webServer: {
    command:
      "node_modules/.bin/vite build --config tests/visual/evidence/harness/vite.config.ts && node_modules/.bin/vite preview --config tests/visual/evidence/harness/vite.config.ts --host 127.0.0.1 --port 4532 --strictPort",
    cwd: "../../..",
    url: "http://127.0.0.1:4532/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
