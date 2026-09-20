/**
 * Statistical Latency Benchmarks (A20)
 *
 * Enforces performance targets from 17_PERFORMANCE_SPEC.md:
 * - 20-run median and p95 statistics (no single lucky run).
 * - Scenario computation budget: <= 50 ms worker math over 2,400 sample rows.
 * - Arithmetic aggregation over full sample dataset.
 * - Emits structured statistical benchmark metrics.
 */
import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDecimal, multiplyDecimal } from "../../packages/contracts/src/decimal.js";
import type { NormalizedTable } from "../../packages/contracts/src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface BenchmarkStats {
  iterations: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
}

export function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))] ?? 0;
}

export function runBenchmark(fn: () => void, iterations = 20): BenchmarkStats {
  const durations: number[] = [];

  // Warmup run (discarded)
  fn();

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const duration = performance.now() - start;
    durations.push(duration);
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const minMs = sorted[0] ?? 0;
  const maxMs = sorted[sorted.length - 1] ?? 0;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const meanMs = sum / sorted.length;
  const medianMs = computePercentile(sorted, 50);
  const p95Ms = computePercentile(sorted, 95);

  return {
    iterations,
    minMs,
    maxMs,
    meanMs,
    medianMs,
    p95Ms,
  };
}

describe("20-run statistical performance benchmarks (A20)", () => {
  const fixturePath = path.join(repoRoot, "tests/contract/fixtures/normalized-table.example.json");
  const tableData: NormalizedTable = JSON.parse(readFileSync(fixturePath, "utf8"));

  it("loads 2,400 clean rows fixture as benchmark baseline", () => {
    expect(tableData.rows.length).toBe(2400);
    expect(tableData.columns.length).toBe(11);
  });

  it("scenario computation (+8% cost factor) meets <= 50ms budget over 20 runs", () => {
    const factor = "1.08"; // +8% cost scenario

    // Benchmark function: apply +8% scenario to operating_cost across all 2,400 rows and recompute sum
    const stats = runBenchmark(() => {
      let baselineSum = "0";
      let scenarioSum = "0";
      for (const row of tableData.rows) {
        const costStr = row.values["operating_cost"];
        if (costStr && typeof costStr === "string") {
          baselineSum = addDecimal(baselineSum, costStr);
          const adjusted = multiplyDecimal(costStr, factor);
          scenarioSum = addDecimal(scenarioSum, adjusted);
        }
      }
      return { baselineSum, scenarioSum };
    }, 20);

    expect(stats.iterations).toBe(20);
    // Budget (17_PERFORMANCE_SPEC.md): worker math <= 50ms median; perceived response <= 100ms p95
    expect(stats.medianMs).toBeLessThan(50);
    expect(stats.p95Ms).toBeLessThan(100);
  });

  it("full table measure aggregations meet high-throughput performance expectations", () => {
    const measureColIds = tableData.columns
      .filter((col) => col.role === "measure" && col.type === "decimal")
      .map((col) => col.id);

    // Aggregate all decimal measure columns across 2,400 rows
    const stats = runBenchmark(() => {
      const sums: Record<string, string> = {};
      for (const id of measureColIds) sums[id] = "0";

      for (const row of tableData.rows) {
        for (const id of measureColIds) {
          const val = row.values[id];
          if (val && typeof val === "string") {
            sums[id] = addDecimal(sums[id] ?? "0", val);
          }
        }
      }
      return sums;
    }, 20);

    expect(stats.iterations).toBe(20);
    expect(stats.medianMs).toBeLessThan(100);
    expect(stats.p95Ms).toBeLessThan(150);
  });
});
