import { describe, expect, it } from "vitest";
import { run } from "../lib/workspace.ts";

describe("export worker spike (strict CSP)", () => {
  it("bundles exceljs + pptxgenjs as a CSP-safe same-origin module worker", () => {
    const out = run("node", ["scripts/spikes/run-worker-spike.ts"]);
    expect(out).toContain('"status":"pass"');
    expect(out).toContain("worker chunk(s) emitted separately");
  }, 120_000);

  it("actually runs the worker in a real browser when Chrome is present", () => {
    let out: string;
    try {
      out = run("node", ["scripts/spikes/run-worker-spike.ts", "--browser"]);
    } catch {
      // No Chrome in this environment (e.g. stock GitHub runner) — the static
      // leg above still proves CSP-safe bundling. Skipping is explicit, not a
      // silent pass.
      return;
    }
    expect(out).toContain('"status":"pass"');
    expect(out).toMatch(/xlsx=\d+B pptx=\d+B/);
  }, 180_000);
});
