import { defineConfig } from "@playwright/test";

/**
 * Browser harness for the conservative upload UX (owned path
 * tests/visual/upload). The webServer builds the gallery then serves the exact
 * static artifact via `vite preview` — tests never exercise the dev server.
 * Artifacts land in tests/visual/upload/artifacts/ — never committed.
 *
 *   pnpm exec playwright test --config tests/visual/upload/playwright.config.ts
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
    baseURL: process.env.ROWFOLIO_UPLOAD_BASE_URL ?? "http://127.0.0.1:4532",
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
      testMatch: /spec\.ts$/,
    },
    {
      name: "desktop-ar",
      use: { viewport: { width: 1440, height: 900 }, locale: "ar-QA" },
      testMatch: /spec\.ts$/,
    },
    {
      name: "mobile-en",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      testMatch: /flow\.spec|keyboard\.spec/,
    },
    {
      name: "mobile-ar",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "ar-QA",
      },
      testMatch: /flow\.spec|keyboard\.spec/,
    },
  ],
  webServer: {
    command:
      "../../../node_modules/.bin/vite build --config gallery/vite.config.ts && ../../../node_modules/.bin/vite preview --config gallery/vite.config.ts --host 127.0.0.1 --port 4532 --strictPort",
    cwd: ".",
    url: "http://127.0.0.1:4532/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
