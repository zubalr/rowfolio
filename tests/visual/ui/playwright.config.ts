import { defineConfig } from "@playwright/test";

/**
 * Visual/a11y harness for @rowfolio/ui (task A03, owned path tests/visual/ui).
 *
 * The webServer builds the gallery (`vite build`) then serves the exact static
 * artifact via `vite preview` — tests never exercise the dev server. Browser:
 * playwright-managed chromium headless shell; set CHROMIUM_PATH to use a known
 * local binary instead (matches scripts/check_prototype.py convention).
 *
 * Artifacts land in tests/visual/ui/artifacts/ (screenshots, axe JSON) — they
 * are generated evidence, never committed. Run:
 *   pnpm exec playwright test --config tests/visual/ui/playwright.config.ts
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
    baseURL: process.env.ROWFOLIO_UI_BASE_URL ?? "http://127.0.0.1:4531",
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
      testMatch: /gallery|dialog|keyboard|contrast|zoom|motion|accessibility/,
    },
    {
      name: "desktop-ar",
      use: { viewport: { width: 1440, height: 900 }, locale: "ar-QA" },
      testMatch: /gallery|dialog|keyboard|contrast|accessibility/,
    },
    {
      name: "mobile-en",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      testMatch: /gallery|dialog|layout/,
    },
    {
      name: "mobile-ar",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        locale: "ar-QA",
      },
      testMatch: /gallery|dialog|layout/,
    },
    {
      name: "narrow-320",
      use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true },
      testMatch: /layout/,
    },
  ],
  webServer: {
    command:
      "node_modules/.bin/vite build --config gallery/vite.config.ts && node_modules/.bin/vite preview --config gallery/vite.config.ts --host 127.0.0.1 --port 4531 --strictPort",
    cwd: "../../packages/ui",
    url: "http://127.0.0.1:4531/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
