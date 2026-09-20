/**
 * axe-core scan of the open evidence drawer — the darkest surface + modal
 * semantics + data tables + struck-through raw values. Same rule engine as
 * tests/visual/ui (root devDependency).
 */
import { createRequire } from "node:module";
import * as path from "node:path";
import * as fs from "node:fs";
import { expect, test } from "@playwright/test";
import { localeOf, openDialog } from "./helpers.ts";

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

test.describe("evidence drawer accessibility", () => {
  test("open revenue-gap drawer has no axe violations", async ({ page }, info) => {
    const locale = localeOf(info);
    await openDialog(page, "revenue-gap", locale);
    const violations = await runAxe(page);
    const out = path.join(info.project.testDir, "..", "artifacts", info.project.name);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, `axe-evidence-${locale}.json`),
      JSON.stringify(violations, null, 2),
    );
    expect(violations.map((v) => `${v.id} (${v.impact})`)).toEqual([]);
  });
});
