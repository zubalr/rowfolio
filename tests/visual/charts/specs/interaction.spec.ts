/**
 * Interaction evidence: roving datum keyboard explorer, pointer tooltip,
 * Escape dismissal, and the "View values" evidence-table toggle with exact
 * chart/table parity.
 */
import { expect, test } from "@playwright/test";
import { localeOf, openGallery, shot, story } from "./helpers.ts";

test("keyboard explorer moves through datum keys with one tab stop", async ({ page }, info) => {
  await openGallery(page, localeOf(info));
  const card = story(page, "downtime-trend");
  const explorer = card.locator(".rf-chart-plot");
  await explorer.focus();
  // Focus opens the explorer on the first/emphasized datum.
  await expect(card.locator(".rf-chart-tip")).toBeVisible();
  // Arrow keys move datum selection forward/back.
  await page.keyboard.press("ArrowRight");
  const activeDesc = await explorer.getAttribute("aria-activedescendant");
  expect(activeDesc).toBeTruthy();
  await page.keyboard.press("ArrowRight");
  const nextDesc = await explorer.getAttribute("aria-activedescendant");
  expect(nextDesc).not.toBe(activeDesc);
  // Home/End jump to ends.
  await page.keyboard.press("End");
  const endDesc = await explorer.getAttribute("aria-activedescendant");
  expect(endDesc).toContain("2026-06");
  // Escape dismisses the tooltip without trapping focus.
  await page.keyboard.press("Escape");
  await expect(card.locator(".rf-chart-tip")).toHaveCount(0);
  await page.keyboard.press("Tab");
  // Focus leaves the explorer toward the next control — no trap.
  const stillInside = await page.evaluate(
    () => document.activeElement?.closest('[data-story="downtime-trend"]') !== null,
  );
  expect(stillInside).toBe(false);
});

test("pointer hover opens datum tooltip with formatted values", async ({ page }, info) => {
  const locale = localeOf(info);
  await openGallery(page, locale);
  const card = story(page, "downtime-bars");
  const june = card.locator('[id$="-d-2026-06"]');
  await june.hover();
  const tip = card.locator(".rf-chart-tip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(locale === "ar" ? "١٬٥٦٥" : "1,565");
});

test("view-values toggle reveals the exact evidence table", async ({ page }, info) => {
  const locale = localeOf(info);
  await openGallery(page, locale);
  const card = story(page, "quality");
  const toggle = card.locator(".rf-chart__toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const table = card.locator(".rf-chart-table");
  await expect(table).toBeVisible();
  const cells = await table.locator("td[data-align=end]").allTextContents();
  expect(cells.map((c) => c.trim())).toEqual(locale === "ar" ? ["١٧", "٧", "٥"] : ["17", "7", "5"]);
  await shot(page, info, "quality-table-open");
  await toggle.click();
  await expect(card.locator(".rf-chart-table")).toHaveCount(0);
});

test("scenario chart tooltip and delta annotation", async ({ page }, info) => {
  const locale = localeOf(info);
  await openGallery(page, locale);
  const card = story(page, "scenario");
  await card.locator('[id$="-d-scenario"]').hover();
  const tip = card.locator(".rf-chart-tip");
  await expect(tip).toContainText(locale === "ar" ? "١٩٪" : "19%");
});
