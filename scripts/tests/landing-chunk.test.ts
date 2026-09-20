import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { run, repoRoot } from "../lib/workspace.ts";

describe("static build and landing-chunk boundary", () => {
  it("builds localized static entries and passes the static-only audit", () => {
    run("pnpm", ["--filter", "@rowfolio/web", "build"]);
    const out = run("node", ["scripts/audit-static.ts"]);
    expect(out).toContain('"status":"pass"');
    expect(out).toContain("index.html");
  }, 120_000);

  it("the landing entry chunk contains no parser/export/chart modules", () => {
    const dist = path.join(repoRoot, "apps/web/dist");
    const map = JSON.parse(
      readFileSync(path.join(dist, ".vite", "module-map.json"), "utf8"),
    ) as Record<string, string[]>;
    const html = readFileSync(path.join(dist, "index.html"), "utf8");
    const entry = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)][0]?.[1]?.replace(/^\//, "");
    expect(entry).toBeTruthy();
    const modules = map[entry as string] ?? [];
    const forbidden = /node_modules\/\.pnpm\/(xlsx|exceljs|pptxgenjs|papaparse|fflate|d3-|motion)@/;
    expect(modules.filter((m) => forbidden.test(m))).toEqual([]);
  });
});
