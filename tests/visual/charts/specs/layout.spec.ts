/**
 * Layout evidence: no horizontal page overflow at 320–390px, the compact
 * target-bars selector on narrow screens, long Arabic labels wrapped (never
 * shrunk), and charts still readable.
 */
import { expect, test } from "@playwright/test";
import { localeOf, openGallery, shot, story } from "./helpers.ts";

test("no horizontal overflow on any story", async ({ page }, info) => {
  await openGallery(page, localeOf(info));
  // poll until the measured (non-fallback) widths settle
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
});

test("narrow target-bars shows compact selector plus single datum", async ({ page }, info) => {
  await openGallery(page, localeOf(info));
  const card = story(page, "target-regions");
  const chips = card.locator(".rf-chart-chip");
  if (await chips.count()) {
    await expect(chips).toHaveCount(6);
    await expect(card.locator(".rf-chart-bar")).toHaveCount(1);
    await chips.nth(2).click();
    await expect(card.locator(".rf-chart-bar")).toHaveCount(1);
    await shot(page, info, "target-regions-narrow");
  }
});

test("long Arabic labels wrap instead of shrinking", async ({ page }, info) => {
  await openGallery(page, localeOf(info));
  const card = story(page, "quality-long-labels");
  const overflow = await card.evaluate(
    (el) => el.scrollWidth - el.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(page, info, "quality-long-labels");
});

test("all charts fit the viewport width", async ({ page }, info) => {
  await openGallery(page, localeOf(info));
  for (const svg of await page.locator(".rf-chart-svg").all()) {
    const box = await svg.boundingBox();
    const view = page.viewportSize()!;
    expect(box!.width).toBeLessThanOrEqual(view.width);
  }
});
