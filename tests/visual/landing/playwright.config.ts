import { defineConfig } from "@playwright/test";

/**
 * Visual/interaction harness for the landing + guided demo (owned path
 * tests/visual/landing). Builds apps/web (`vite build`) and serves the exact
 * static artifact via `vite preview` — tests never exercise the dev server.
 * Artifacts land in artifacts/ (generated evidence, never committed).
 *
 * Run:  pnpm exec playwright test --config tests/visual/landing/playwright.config.ts
 */
export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  outputDir: "./test-results",
  timeout: 90_000,
  use: {
    baseURL: process.env.ROWFOLIO_LANDING_BASE_URL ?? "http://127.0.0.1:4533",
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
      testMatch: /specs[\\/](landing|guide|motion)\.spec\.ts/,
    },
    {
      name: "desktop-ar",
      use: { viewport: { width: 1440, height: 900 }, locale: "ar-QA" },
      testMatch: /specs[\\/](landing|guide)\.spec\.ts/,
    },
    {
      name: "mobile-en",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      testMatch: /specs[\\/]landing\.spec\.ts/,
    },
    {
      name: "mobile-ar",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "ar-QA",
      },
      testMatch: /specs[\\/]landing\.spec\.ts/,
    },
    {
      name: "narrow-320",
      use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true },
      testMatch: /specs[\\/]landing\.spec\.ts/,
    },
    {
      name: "reduced-motion",
      use: {
        viewport: { width: 1440, height: 900 },
        locale: "en-US",
        reducedMotion: "reduce",
      },
      testMatch: /specs[\\/]motion\.spec\.ts/,
    },
  ],
  webServer: {
    command:
      "node_modules/.bin/vite build && node_modules/.bin/vite preview --host 127.0.0.1 --port 4533 --strictPort",
    cwd: "../../../apps/web",
    url: "http://127.0.0.1:4533/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
