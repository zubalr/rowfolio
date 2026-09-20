/**
 * Statistical Latency Benchmarks
 *
 * Evaluates calculation latency and statistical performance profiles:
 * - Multi-run median and p95 benchmarks across sample records.
 * - Scenario computation latency over clean normalized rows.
 * - Numeric measure aggregation throughput.
 */
import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDecimal, multiplyDecimal } from "../../packages/contracts/src/index.ts";
import type { NormalizedTable } from "../../packages/contracts/src/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface BenchmarkStats {
  iterations: number;
  sampleRowCount: number;
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

export function runBenchmark(fn: () => void, rowCount: number, iterations = 20, warmups = 3): BenchmarkStats {
  const durations: number[] = [];

  // JIT Warmup runs
  for (let w = 0; w < warmups; w++) {
    fn();
  }

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
    sampleRowCount: rowCount,
    minMs,
    maxMs,
    meanMs,
    medianMs,
    p95Ms,
  };
}

describe("statistical calculation performance benchmarks", () => {
  const fixturePath = path.join(repoRoot, "tests/contract/fixtures/normalized-table.example.json");
  const tableData: NormalizedTable = JSON.parse(readFileSync(fixturePath, "utf8"));

  it("loads normalized table fixture for benchmark baseline", () => {
    expect(tableData.rows.length).toBeGreaterThan(0);
    expect(tableData.columns.length).toBeGreaterThan(0);
  });

  it("scenario computation (+8% cost factor) meets latency budget over 20 runs", () => {
    const factor = "1.08";
    const rowCount = tableData.rows.length;

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
    }, rowCount, 20);

    expect(stats.iterations).toBe(20);
    expect(stats.sampleRowCount).toBe(rowCount);
    // ≤50ms dedicated worker math target; ≤100ms perceived response limit under host runner concurrency
    expect(stats.medianMs).toBeLessThan(100);
    expect(stats.p95Ms).toBeLessThan(150);
  });

  it("full table measure aggregations meet high-throughput performance expectations", () => {
    const measureColIds = tableData.columns
      .filter((col) => col.role === "measure" && col.type === "decimal")
      .map((col) => col.id);
    const rowCount = tableData.rows.length;

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
    }, rowCount, 20);

    expect(stats.iterations).toBe(20);
    expect(stats.sampleRowCount).toBe(rowCount);
    expect(stats.medianMs).toBeLessThan(100);
    expect(stats.p95Ms).toBeLessThan(150);
  });
});
