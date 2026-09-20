/**
 * Per-kind rendering evidence: every chart kind in both locales at desktop
 * and mobile widths, plus the edge-case card (negative/zero/missing).
 * Assertions check rendered DOM truth — values, axes, dashed scenario
 * encoding — not just pixels.
 */
import { expect, test } from "@playwright/test";
import { artifactPath, localeOf, openGallery, shot, story } from "./helpers.ts";

const STORIES = [
  "target-single",
  "target-regions",
  "downtime-trend",
  "downtime-bars",
  "quality",
  "quality-long-labels",
  "scenario",
  "edge",
];

for (const name of STORIES) {
  test(`story ${name} renders and photographs`, async ({ page }, info) => {
    const locale = localeOf(info);
    await openGallery(page, locale);
    const card = story(page, name);
    await expect(card.locator("svg")).toBeVisible();
    await expect(card.locator(".rf-chart__title")).not.toBeEmpty();
    await expect(card.locator(".rf-chart__summary")).not.toBeEmpty();
    await card.screenshot({ path: artifactPath(info, name) });
  });
}

test("target-bars shows actual bar, dashed target marker and signed variance", async ({
  page,
}, info) => {
  const locale = localeOf(info);
  await openGallery(page, locale);
  const card = story(page, "target-single");
  await expect(card.locator(".rf-chart-bar")).toHaveCount(1);
  await expect(card.locator(".rf-chart-target")).toHaveCount(1);
  await expect(card.locator(".rf-chart-delta")).toContainText(
    locale === "ar" ? "١١٫٩٪" : "11.9%",
  );
});

test("scenario-bars renders baseline solid and scenario dashed on the fixed domain", async ({
  page,
}, info) => {
  await openGallery(page, localeOf(info));
  const card = story(page, "scenario");
  const bars = card.locator(".rf-chart-bar");
  await expect(bars).toHaveCount(2);
  const scenarioDash = await bars.nth(1).getAttribute("stroke-dasharray");
  expect(scenarioDash).toBe("5 3");
  await expect(card.locator(".rf-chart-note")).toBeVisible();
  // fixed domain 0..0.30 → axis top tick must not exceed 30%
  const ticks = await card.locator(".rf-chart-tick").allTextContents();
  expect(ticks.length).toBeGreaterThan(0);
  for (const t of ticks) {
    const n = Number(t.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^\d.-]/g, ""));
    if (!Number.isNaN(n)) expect(n).toBeLessThanOrEqual(30);
  }
});

test("trend chart keeps LTR point order in both locales", async ({ page }, info) => {
  const locale = localeOf(info);
  await openGallery(page, locale);
  const card = story(page, "downtime-trend");
  const cats = card.locator(".rf-chart-cat");
  const texts = await cats.allTextContents();
  const march = locale === "ar" ? "مارس" : "March";
  const june = locale === "ar" ? "يونيو" : "June";
  expect(texts[0]).toContain(march);
  expect(texts[texts.length - 1]).toContain(june);
  const boxes = await cats.evaluateAll((els) =>
    els.map((el) => (el as SVGTextElement).getBoundingClientRect().x),
  );
  expect(boxes[0]!).toBeLessThan(boxes[boxes.length - 1]!);
});

test("edge story renders negative bar, zero bar and missing marker", async ({ page }, info) => {
  await openGallery(page, localeOf(info));
  const card = story(page, "edge");
  await expect(card.locator(".rf-chart-missing")).toHaveCount(1);
  await expect(card.locator(".rf-chart-bar")).toHaveCount(3);
});

test("full gallery page", async ({ page }, info) => {
  await openGallery(page, localeOf(info));
  await shot(page, info, "gallery-full");
});
