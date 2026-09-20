/**
 * Gallery coverage: full-matrix screenshots per locale/viewport, direction
 * and font wiring, and presence of every primitive region.
 */
import { expect, test } from "@playwright/test";
import { copy, localeOf, openGallery, shot } from "./helpers.ts";

test.describe("gallery matrix", () => {
  test("renders every primitive with the project font and direction", async ({
    page,
  }, info) => {
    const locale = localeOf(info);
    await openGallery(page, locale);

    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      locale === "ar" ? "rtl" : "ltr",
    );

    // Every primitive region is present and visible.
    await expect(page.locator('[data-story="buttons"]')).toBeVisible();
    await expect(page.locator('[data-story="fields"]')).toBeVisible();
    await expect(page.locator(".rf-metric-strip")).toBeVisible();
    await expect(page.locator('[data-story="status"]')).toBeVisible();
    await expect(page.locator(".rf-table-scroll .rf-table")).toBeVisible();

    // IBM Plex applies (fontsource-provided stacks), not system fallbacks.
    const bodyFont = await page.evaluate(
      () => getComputedStyle(document.body).fontFamily,
    );
    expect(bodyFont).toContain(locale === "ar" ? "IBM Plex Sans Arabic" : "IBM Plex Sans");
    const monoFont = await page
      .locator(".rf-mono")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(monoFont).toContain("IBM Plex Mono");

    // Arabic line height is roomier than English.
    const bodyLine = await page.evaluate(
      () => parseFloat(getComputedStyle(document.body).lineHeight),
    );
    const bodySize = await page.evaluate(
      () => parseFloat(getComputedStyle(document.body).fontSize),
    );
    const ratio = bodyLine / bodySize;
    if (locale === "ar") {
      expect(ratio).toBeGreaterThanOrEqual(1.6);
      expect(bodySize).toBeGreaterThanOrEqual(16.5);
    } else {
      expect(bodySize).toBeGreaterThanOrEqual(16);
    }

    // Sticky table header stays on top while the region scrolls.
    const scrollBox = page.locator(".rf-table-scroll");
    await scrollBox.waitFor({ state: "visible" });
    await scrollBox.evaluate((el) => {
      el.scrollTop = 240;
    });
    const headTop = await page
      .locator(".rf-table-scroll thead th")
      .first()
      .evaluate((el) => {
      const head = el.getBoundingClientRect();
      const region = el.closest(".rf-table-scroll")!.getBoundingClientRect();
      return head.top - region.top;
    });
    // Pinned to the region top (small constant = caption/border spacing).
    expect(headTop).toBeGreaterThanOrEqual(-1);
    expect(headTop).toBeLessThan(16);

    // Source rows show as visible LTR R# islands.
    const firstSource = page.locator(".rf-table__sourcerow bdi").first();
    await expect(firstSource).toHaveText("R1802");
    await expect(firstSource).toHaveAttribute("dir", "ltr");

    await shot(page, info, `gallery-${locale}`);
  });

  test("metric strip renders values, units and deltas", async ({ page }, info) => {
    const locale = localeOf(info);
    await openGallery(page, locale);
    const strip = page.locator(".rf-metric-strip");
    await expect(strip).toHaveAttribute("role", "group");
    await expect(strip.locator(".rf-metric")).toHaveCount(6);
    // Undefined metric states its reason rather than a fake number.
    await expect(strip.locator(".rf-metric").last()).toContainText(
      copy(locale).undefinedReason,
    );
  });
});
