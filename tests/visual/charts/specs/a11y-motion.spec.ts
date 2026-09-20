/**
 * axe-core structural scan of the chart gallery (root devDependency, same
 * rule engine as tests/visual/ui), bounded-tab-stop checks, reduced-motion
 * rendering and the datum live-region announcement.
 */
import { createRequire } from "node:module";
import * as path from "node:path";
import * as fs from "node:fs";
import { expect, test } from "@playwright/test";
import { localeOf, openGallery } from "./helpers.ts";

const require = createRequire(import.meta.url);
const AXE_SOURCE = path.join(
  path.dirname(require.resolve("axe-core/package.json")),
  "axe.min.js",
);

interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: { target: string[] }[];
}

async function runAxe(page: import("@playwright/test").Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (el: Element) => Promise<{ violations: AxeViolation[] }> };
    };
    const results = await w.axe.run(document.documentElement);
    return results.violations;
  });
}

test("chart gallery has no axe violations", async ({ page }, info) => {
  const locale = localeOf(info);
  await openGallery(page, locale);
  const violations = await runAxe(page);
  const out = path.join(info.project.testDir, "..", "artifacts", info.project.name);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `axe-charts-${locale}.json`), JSON.stringify(violations, null, 2));
  const serious = violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(serious.map((v) => `${v.id} (${v.impact})`)).toEqual([]);
});

test("open evidence table has no axe violations", async ({ page }, info) => {
  const locale = localeOf(info);
  await openGallery(page, locale);
  const card = page.locator('[data-story="quality"]');
  await card.locator(".rf-chart__toggle").click();
  await expect(card.locator(".rf-chart-table")).toBeVisible();
  const violations = await runAxe(page);
  const out = path.join(info.project.testDir, "..", "artifacts", info.project.name);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, `axe-table-${locale}.json`),
    JSON.stringify(violations, null, 2),
  );
  const serious = violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(serious.map((v) => `${v.id} (${v.impact})`)).toEqual([]);
});

test("each chart exposes bounded tab stops (toggle + one datum explorer)", async ({
  page,
}, info) => {
  await openGallery(page, localeOf(info));
  for (const figure of await page.locator(".rf-chart").all()) {
    const tabbables = await figure.locator("button, a[href], [tabindex]").all();
    const countable: string[] = [];
    for (const el of tabbables) {
      if ((await el.getAttribute("tabindex")) === "-1") continue;
      countable.push((await el.getAttribute("class")) ?? (await el.evaluate((e) => e.tagName)));
    }
    // toolbar toggle + explorer (+ compact chips in narrow mode)
    expect(countable.length).toBeLessThanOrEqual(8);
  }
});

test("reduced motion keeps final state without transitions", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openGallery(page, localeOf(info));
  const durations = await page.locator(".rf-chart-bar").first().evaluate(
    (el) => getComputedStyle(el).transitionDuration,
  );
  expect(["0s", "0s, 0s", ""]).toContain(durations);
});

test("charts announce the active datum through a polite live region", async ({ page }, info) => {
  await openGallery(page, localeOf(info));
  const card = page.locator('[data-story="downtime-bars"]');
  await card.locator(".rf-chart-plot").focus();
  await page.keyboard.press("ArrowRight");
  const live = card.locator('[aria-live="polite"]');
  await expect(live).not.toBeEmpty();
});
