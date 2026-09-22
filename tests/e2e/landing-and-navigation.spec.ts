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

    // Brand and heading check
    const brand = await page.textContent(".rf-brand");
    expect(brand).toContain("Rowfolio");
    const heading = await page.textContent("h1");
    expect(heading).toBeTruthy();

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

    // Arabic brand and heading check
    const brand = await page.textContent(".rf-brand");
    expect(brand).toContain("روفوليو");
    const heading = await page.textContent("h1");
    expect(heading).toBeTruthy();

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

  // The lazy workspace chunk used to redefine landing's `.rf-stage` and
  // `.rf-plate` selectors; once loaded, its CSS persisted after returning
  // home and collapsed the stage frame (~507px to ~154px). Workspace classes
  // are now namespaced (`.rf-wstage`/`.rf-wplate`) so this must not regress.
  for (const localePath of ["/", "/ar/"] as const) {
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1280, height: 800 },
      phone: { width: 390, height: 844 },
    })) {
      test(`stage + plates keep landing styles after workspace round-trip (${localePath} ${name})`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(localePath);
        const intactFrame = await page
          .locator(".rf-stage__frame")
          .evaluate((el) => el.getBoundingClientRect().height);
        await page.locator('[data-testid="cta-explore"]').click();
        await page.waitForSelector(".rf-workspace");
        await page.locator(".rf-brand.rf-brand-btn").click();
        await page.waitForSelector(".rf-stage__frame");
        const stageDisplay = await page
          .locator(".rf-stage")
          .evaluate((el) => getComputedStyle(el).display);
        const roundTripFrame = await page
          .locator(".rf-stage__frame")
          .evaluate((el) => el.getBoundingClientRect().height);
        expect(stageDisplay).toBe("flex");
        expect(roundTripFrame).toBeCloseTo(intactFrame, -1);
      });
    }
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
