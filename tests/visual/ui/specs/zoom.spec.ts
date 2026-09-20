/**
 * Zoom + reduced-motion evidence (05_MOTION_SPEC: durations collapse to 0
 * under prefers-reduced-motion; content stays navigable at 200% zoom —
 * emulated with CSS zoom since Chromium page-zoom isn't exposed to tests).
 */
import { expect, test } from "@playwright/test";
import { copy, openGallery, shot } from "./helpers.ts";

test.describe("zoom and motion", () => {
  test("200% zoom: no horizontal overflow, controls still usable", async ({
    page,
  }, info) => {
    await openGallery(page, "en");
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await page.waitForTimeout(60);
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth / 2 - doc.clientWidth / 2;
    });
    expect(overflow).toBeLessThanOrEqual(2);

    // Dialog still opens and holds focus under zoom.
    await page
      .getByRole("button", { name: copy("en").openPanel, exact: true })
      .click();
    const dialog = page.locator('dialog[data-testid="evidence-dialog"]');
    await expect(dialog).toBeVisible();
    await shot(page, info, "zoom-200-drawer", { fullPage: false });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    await shot(page, info, "zoom-200-page");
  });

  test("reduced motion collapses transitions", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await openGallery(page, "en");
    const duration = await page
      .locator(".rf-btn")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    // Every transition segment collapses to <=0.01ms (tokens zero + global rule).
    const maxMs = Math.max(
      ...duration.split(",").map((part) => {
        const v = parseFloat(part);
        return part.trim().endsWith("ms") ? v : v * 1000;
      }),
    );
    expect(maxMs).toBeLessThanOrEqual(0.01);
    await context.close();
  });

  test("default motion keeps specified durations", async ({ page }) => {
    await openGallery(page, "en");
    const duration = await page
      .locator(".rf-btn")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration).toContain("0.12s");
  });
});
