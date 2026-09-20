import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditBundleBudgets,
  PERFORMANCE_BUDGETS,
  HEAVY_PARSER_EXPORT_MODULES,
} from "../../tooling/audits/bundle-budget-audit.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("bundle budget auditor (A20)", () => {
  it("defines strict performance budget limits from spec", () => {
    expect(PERFORMANCE_BUDGETS.landingInitialJs.maxGzipBytes).toBe(150 * 1024);
    expect(PERFORMANCE_BUDGETS.landingCriticalAssets.maxGzipBytes).toBe(350 * 1024);
    expect(PERFORMANCE_BUDGETS.sampleSnapshot.maxGzipBytes).toBe(80 * 1024);
  });

  it("identifies heavy parser, export, and chart modules", () => {
    const testModules = [
      "node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.mjs",
      "node_modules/.pnpm/exceljs@4.4.0/node_modules/exceljs/dist/exceljs.min.js",
      "node_modules/.pnpm/pptxgenjs@3.12.0/node_modules/pptxgenjs/dist/pptxgen.js",
      "node_modules/.pnpm/papaparse@5.5.2/node_modules/papaparse/papaparse.js",
      "node_modules/.pnpm/fflate@0.8.2/node_modules/fflate/esm/index.js",
      "node_modules/.pnpm/d3-scale@4.0.9/node_modules/d3-scale/src/index.js",
      "node_modules/.pnpm/motion@12.4.7/node_modules/motion/dist/es/index.mjs",
    ];

    for (const mod of testModules) {
      const isHeavy = HEAVY_PARSER_EXPORT_MODULES.some((re) => re.test(mod));
      expect(isHeavy).toBe(true);
    }

    const safeModule = "node_modules/.pnpm/react@19.3.0/node_modules/react/index.js";
    expect(HEAVY_PARSER_EXPORT_MODULES.some((re) => re.test(safeModule))).toBe(false);
  });

  it("audits dist directory budgets when apps/web/dist is built", () => {
    const distDir = path.resolve(repoRoot, "apps/web/dist");
    const result = auditBundleBudgets(distDir);
    expect(result.heavyModulesInLanding).toEqual([]);
    if (Object.keys(result.measurements).length > 0) {
      expect(result.passed).toBe(true);
      for (const b of result.budgets) {
        expect(b.actualGzipBytes).toBeLessThanOrEqual(b.limitGzipBytes);
      }
    }
  });
});
