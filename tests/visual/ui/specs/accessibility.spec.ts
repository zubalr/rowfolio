/**
 * axe-core structural scan over the full gallery matrix — both locales,
 * plus the open evidence drawer (the darkest surface + modal semantics).
 * axe is the WCAG rule engine used across the repo (root devDependency).
 */
import { createRequire } from "node:module";
import * as path from "node:path";
import * as fs from "node:fs";
import { expect, test } from "@playwright/test";
import { copy, localeOf, openGallery } from "./helpers.ts";

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

test.describe("accessibility scan", () => {
  test("gallery matrix has no axe violations", async ({ page }, info) => {
    const locale = localeOf(info);
    await openGallery(page, locale);
    const violations = await runAxe(page);
    const out = path.join(info.project.testDir, "..", "artifacts", info.project.name);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, `axe-gallery-${locale}.json`),
      JSON.stringify(violations, null, 2),
    );
    expect(violations.map((v) => `${v.id} (${v.impact})`)).toEqual([]);
  });

  test("open evidence drawer has no axe violations", async ({ page }, info) => {
    const locale = localeOf(info);
    const s = copy(locale);
    await openGallery(page, locale);
    await page.getByRole("button", { name: s.openPanel, exact: true }).click();
    await expect(page.locator('dialog[data-testid="evidence-dialog"]')).toBeVisible();
    const violations = await runAxe(page);
    const out = path.join(info.project.testDir, "..", "artifacts", info.project.name);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, `axe-drawer-${locale}.json`),
      JSON.stringify(violations, null, 2),
    );
    expect(violations.map((v) => `${v.id} (${v.impact})`)).toEqual([]);
  });
});
