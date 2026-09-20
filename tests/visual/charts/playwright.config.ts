import { defineConfig } from "@playwright/test";

/**
 * Visual/a11y harness for @rowfolio/charts (owned path tests/visual/charts).
 *
 * The webServer builds the fixture gallery (`vite build`) then serves the
 * exact static artifact via `vite preview` — tests never exercise the dev
 * server. vite resolves from the repo-root binary (charts declares no vite
 * devDependency on purpose; the gallery is test tooling, not shipped code).
 * Set CHROMIUM_PATH to use a known local binary instead of the playwright-
 * managed chromium.
 *
 * Artifacts land in tests/visual/charts/artifacts/ — generated evidence,
 * never committed. Run:
 *   pnpm exec playwright test --config tests/visual/charts/playwright.config.ts
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
    baseURL: process.env.ROWFOLIO_CHARTS_BASE_URL ?? "http://127.0.0.1:4532",
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
      testMatch: /(charts|interaction|a11y-motion)\.spec\.ts$/,
    },
    {
      name: "desktop-ar",
      use: { viewport: { width: 1440, height: 900 }, locale: "ar-QA" },
      testMatch: /(charts|interaction|a11y-motion)\.spec\.ts$/,
    },
    {
      name: "mobile-en",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      testMatch: /(charts|layout)\.spec\.ts$/,
    },
    {
      name: "mobile-ar",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar-QA" },
      testMatch: /(charts|layout)\.spec\.ts$/,
    },
    {
      name: "narrow-320",
      use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true },
      testMatch: /layout\.spec\.ts$/,
    },
  ],
  webServer: {
    command:
      "../../node_modules/.bin/vite build --config gallery/vite.config.ts && ../../node_modules/.bin/vite preview --config gallery/vite.config.ts --host 127.0.0.1 --port 4532 --strictPort",
    cwd: "../../../packages/charts",
    url: "http://127.0.0.1:4532/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
