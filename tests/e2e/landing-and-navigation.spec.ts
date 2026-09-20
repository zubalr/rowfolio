import { test, expect } from "@playwright/test";
import { ensureStaticServer, stopStaticServer, VIEWPORTS, runAxeAudit } from "./helpers.ts";

test.beforeAll(async () => {
  await ensureStaticServer(4173);
});

test.afterAll(() => {
  stopStaticServer();
});

test.describe("Landing & Responsive Viewports", () => {
  test("renders English landing page with correct lang and dir attributes", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/");
    const lang = await page.getAttribute("html", "lang");
    const dir = (await page.getAttribute("html", "dir")) ?? "ltr";

    expect(lang).toBe("en");
    expect(dir).toBe("ltr");

    // Title / heading check
    const heading = await page.textContent("h1");
    expect(heading).toContain("Rowfolio");

    expect(consoleErrors).toEqual([]);
  });

  test("renders Arabic landing page with correct lang and dir attributes", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/ar/");
    const lang = await page.getAttribute("html", "lang");
    const dir = await page.getAttribute("html", "dir");

    expect(lang).toBe("ar");
    expect(dir).toBe("rtl");

    // Arabic title check
    const heading = await page.textContent("h1");
    expect(heading).toContain("روفوليو");

    expect(consoleErrors).toEqual([]);
  });

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`no horizontal page overflow at ${name} viewport (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");

      const hasHorizontalOverflow = await page.evaluate(() => {
        const docEl = document.documentElement;
        return docEl.scrollWidth > docEl.clientWidth;
      });

      expect(hasHorizontalOverflow).toBe(false);
    });
  }

  test("landing page passes automated axe accessibility scan with 0 critical violations", async ({ page }) => {
    await page.goto("/");
    const { violations } = await runAxeAudit(page);

    const criticalOrSerious = violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(criticalOrSerious).toEqual([]);
  });
});
