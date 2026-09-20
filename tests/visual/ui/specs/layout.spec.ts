/**
 * Narrow-width evidence: 320px viewport (both locales via the mobile-ar /
 * narrow-320 projects) — no horizontal overflow, intact touch targets.
 */
import { expect, test } from "@playwright/test";
import { localeOf, openGallery, shot } from "./helpers.ts";

test.describe("narrow layout", () => {
  test("320px: no horizontal overflow, controls keep minimum height", async ({
    page,
  }, info) => {
    const locale = localeOf(info);
    await openGallery(page, locale);

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    // 44px control-height contract holds at the smallest width.
    const buttonBox = await page
      .locator(".rf-btn")
      .first()
      .boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox!.height).toBeGreaterThanOrEqual(43);

    // Section stack doesn't clip: last section is reachable.
    await page.locator(".rf-section").last().scrollIntoViewIfNeeded();
    await expect(page.locator(".rf-section").last()).toBeInViewport();

    await shot(page, info, `layout-${locale}-narrow`);
  });
});
