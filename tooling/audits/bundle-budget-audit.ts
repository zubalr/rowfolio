/**
 * Bundle Size & Performance Budget Auditor
 *
 * Enforces production performance budgets:
 * - Landing initial JS: <= 150 KiB gzip total eager JS
 * - Landing critical assets: <= 350 KiB transferred before LCP
 * - Sample snapshot: <= 80 KiB gzip target
 * - Verification that heavy parser/export/chart engines are NOT bundled into landing chunks.
 */
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

export interface BundleBudget {
  name: string;
  maxGzipBytes: number;
  maxRawBytes?: number;
}

export interface ChunkMeasurement {
  file: string;
  rawBytes: number;
  gzipBytes: number;
}

export interface BudgetAuditResult {
  passed: boolean;
  measurements: Record<string, ChunkMeasurement>;
  budgets: Array<{
    name: string;
    actualGzipBytes: number;
    limitGzipBytes: number;
    passed: boolean;
  }>;
  heavyModulesInLanding: string[];
  errors: string[];
}

export const PERFORMANCE_BUDGETS: Record<string, BundleBudget> = {
  landingInitialJs: {
    name: "Landing initial JS (eager)",
    maxGzipBytes: 150 * 1024, // 150 KiB gzip
  },
  landingCriticalAssets: {
    name: "Landing critical assets (HTML + JS + CSS)",
    maxGzipBytes: 350 * 1024, // 350 KiB gzip
  },
  sampleSnapshot: {
    name: "Sample snapshot JSON",
    maxGzipBytes: 80 * 1024, // 80 KiB gzip
  },
};

export const HEAVY_PARSER_EXPORT_MODULES = [
  /node_modules\/\.pnpm\/xlsx@/,
  /node_modules\/\.pnpm\/exceljs@/,
  /node_modules\/\.pnpm\/pptxgenjs@/,
  /node_modules\/\.pnpm\/papaparse@/,
  /node_modules\/\.pnpm\/fflate@/,
  /node_modules\/\.pnpm\/d3-(scale|shape|array)@/,
  /node_modules\/\.pnpm\/motion@/,
];

export function measureFile(filePath: string): ChunkMeasurement {
  if (!existsSync(filePath)) {
    return { file: filePath, rawBytes: 0, gzipBytes: 0 };
  }
  const raw = readFileSync(filePath);
  const gz = gzipSync(raw);
  return {
    file: filePath,
    rawBytes: raw.length,
    gzipBytes: gz.length,
  };
}

export function auditBundleBudgets(distDir: string): BudgetAuditResult {
  const errors: string[] = [];
  const measurements: Record<string, ChunkMeasurement> = {};
  const heavyModulesInLanding: string[] = [];

  const moduleMapPath = path.join(distDir, ".vite", "module-map.json");

  // Check critical entry points: index.html and ar/index.html
  const entries = ["index.html", "ar/index.html"];
  let totalLandingJsGzip = 0;
  let totalLandingCriticalGzip = 0;

  for (const entryRel of entries) {
    const entryPath = path.join(distDir, entryRel);
    if (!existsSync(entryPath)) {
      continue;
    }
    const htmlMeasurement = measureFile(entryPath);
    measurements[entryRel] = htmlMeasurement;
    totalLandingCriticalGzip += htmlMeasurement.gzipBytes;

    const htmlContent = readFileSync(entryPath, "utf8");
    const scriptMatches = [...htmlContent.matchAll(/<script[^>]+src="([^"]+\.js)"/g)]
      .map((m) => (m[1] ?? "").replace(/^\//, ""))
      .filter(Boolean);

    const cssMatches = [...htmlContent.matchAll(/<link[^>]+href="([^"]+\.css)"/g)]
      .map((m) => (m[1] ?? "").replace(/^\//, ""))
      .filter(Boolean);

    for (const cssRel of cssMatches) {
      const cssPath = path.join(distDir, cssRel);
      if (existsSync(cssPath) && !measurements[cssRel]) {
        const m = measureFile(cssPath);
        measurements[cssRel] = m;
        totalLandingCriticalGzip += m.gzipBytes;
      }
    }

    for (const jsRel of scriptMatches) {
      const jsPath = path.join(distDir, jsRel);
      if (existsSync(jsPath) && !measurements[jsRel]) {
        const m = measureFile(jsPath);
        measurements[jsRel] = m;
        totalLandingJsGzip += m.gzipBytes;
        totalLandingCriticalGzip += m.gzipBytes;
      }
    }
  }

  // Check module map provenance for heavy packages in landing chunks
  if (existsSync(moduleMapPath)) {
    try {
      const moduleMap = JSON.parse(readFileSync(moduleMapPath, "utf8")) as Record<string, string[]>;
      for (const [chunk, modules] of Object.entries(moduleMap)) {
        // If this chunk is among landing JS chunks
        if (measurements[chunk] || Object.keys(measurements).some((k) => k.endsWith(chunk))) {
          for (const mod of modules) {
            for (const heavyPattern of HEAVY_PARSER_EXPORT_MODULES) {
              if (heavyPattern.test(mod)) {
                heavyModulesInLanding.push(`Chunk ${chunk} eagerly imports ${mod}`);
                errors.push(`Heavy module leaked into landing chunk: ${mod}`);
              }
            }
          }
        }
      }
    } catch {
      // non-blocking if map cannot be parsed
    }
  }

  // Sample snapshot budget check (if sample snapshot exists)
  const sampleSnapshotPaths = [
    path.join(distDir, "sample-snapshot.json"),
    path.join(distDir, "data", "sample-snapshot.json"),
    path.join(distDir, "assets", "sample-snapshot.json"),
  ];

  let sampleGzip = 0;
  for (const sPath of sampleSnapshotPaths) {
    if (existsSync(sPath)) {
      const m = measureFile(sPath);
      measurements["sample-snapshot.json"] = m;
      sampleGzip = m.gzipBytes;
      break;
    }
  }

  const budgetEvaluations = [
    {
      name: PERFORMANCE_BUDGETS.landingInitialJs.name,
      actualGzipBytes: totalLandingJsGzip,
      limitGzipBytes: PERFORMANCE_BUDGETS.landingInitialJs.maxGzipBytes,
      passed: totalLandingJsGzip <= PERFORMANCE_BUDGETS.landingInitialJs.maxGzipBytes,
    },
    {
      name: PERFORMANCE_BUDGETS.landingCriticalAssets.name,
      actualGzipBytes: totalLandingCriticalGzip,
      limitGzipBytes: PERFORMANCE_BUDGETS.landingCriticalAssets.maxGzipBytes,
      passed: totalLandingCriticalGzip <= PERFORMANCE_BUDGETS.landingCriticalAssets.maxGzipBytes,
    },
  ];

  if (sampleGzip > 0) {
    budgetEvaluations.push({
      name: PERFORMANCE_BUDGETS.sampleSnapshot.name,
      actualGzipBytes: sampleGzip,
      limitGzipBytes: PERFORMANCE_BUDGETS.sampleSnapshot.maxGzipBytes,
      passed: sampleGzip <= PERFORMANCE_BUDGETS.sampleSnapshot.maxGzipBytes,
    });
  }

  for (const b of budgetEvaluations) {
    if (!b.passed) {
      errors.push(
        `Budget exceeded: ${b.name} (${b.actualGzipBytes} bytes gzip > limit ${b.limitGzipBytes} bytes)`,
      );
    }
  }

  return {
    passed: errors.length === 0,
    measurements,
    budgets: budgetEvaluations,
    heavyModulesInLanding,
    errors,
  };
}
