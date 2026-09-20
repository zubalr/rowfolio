/**
 * Model-layer tests: spec validation, domain resolution, zero baseline,
 * extreme-value extension and tick generation. Values cross in as canonical
 * decimals; these tests pin the display-domain rules in 11_VISUALIZATION_SPEC
 * (never a nonzero bar baseline, never a silently clipped extreme).
 */
import { describe, expect, it } from "vitest";
import type { ChartSpec } from "@rowfolio/contracts";
import { ChartError } from "./errors.ts";
import {
  absoluteVariance,
  chartTicks,
  prepareChart,
  relativeVariance,
} from "./model.ts";
import {
  downtimeBarsExample,
  qualityBarsExample,
  scenarioBarsExample,
  targetBarsAllRegionsExample,
  targetBarsExample,
} from "./examples.ts";

function spec(patch: Partial<ChartSpec>): ChartSpec {
  return { ...targetBarsExample, ...patch } as ChartSpec;
}

describe("prepareChart", () => {
  it("resolves declared domain verbatim for non-bar kinds", () => {
    const m = prepareChart(scenarioBarsExample);
    expect(m.declaredDomain).toEqual({ min: 0, max: 0.3 });
    expect(m.domain).toEqual({ min: 0, max: 0.3 });
  });

  it("forces a zero baseline for bars even when the declared domain omits it", () => {
    const m = prepareChart(
      spec({
        kind: "bars",
        domain: { min: "500", max: "2000" },
        points: [
          { key: "a", labelKey: "x", values: { actual: "800", target: "1500" }, metricIds: [] },
        ],
      }),
    );
    expect(m.declaredDomain).toEqual({ min: 500, max: 2000 });
    expect(m.domain.min).toBe(0);
    expect(m.domain.max).toBe(2000);
  });

  it("extends the display domain to include out-of-range extremes instead of clipping", () => {
    const m = prepareChart(
      spec({ domain: { min: "0", max: "1000" }, points: [
        { key: "a", labelKey: "region.North", values: { actual: "2400", target: "1000" }, metricIds: [] },
      ] }),
    );
    expect(m.domain.max).toBe(2400);
    expect(m.declaredDomain.max).toBe(1000);
  });

  it("opens a window when the domain is degenerate", () => {
    const m = prepareChart(
      spec({
        kind: "line",
        domain: { min: "5", max: "5" },
        points: [
          { key: "a", labelKey: "x", values: { actual: "5" }, metricIds: [] },
        ],
      }),
    );
    expect(m.domain.min).toBeLessThan(5);
    expect(m.domain.max).toBeGreaterThan(5);
  });

  it("keeps null values null and flags an all-null chart as empty", () => {
    const m = prepareChart(
      spec({
        points: [
          { key: "a", labelKey: "region.North", values: { actual: null, target: "10" }, metricIds: [] },
          { key: "b", labelKey: "region.South", values: {}, metricIds: [] },
        ],
      }),
    );
    expect(m.points[0]!.values[0]!.value).toBeNull();
    expect(m.points[1]!.values.every((v) => v.value === null)).toBe(true);
    const empty = prepareChart(
      spec({
        series: [{ id: "actual", labelKey: "common.actual", semantic: "observed" }],
        points: [{ key: "a", labelKey: "region.North", values: {}, metricIds: [] }],
      }),
    );
    expect(empty.empty).toBe(true);
  });

  it("rejects inverted domains, undeclared series and non-decimal values", () => {
    expect(() => prepareChart(spec({ domain: { min: "10", max: "5" } }))).toThrowError(
      expect.objectContaining({ code: "invalid-domain" }) as ChartError,
    );
    expect(() =>
      prepareChart(
        spec({
          points: [
            { key: "a", labelKey: "x", values: { ghost: "1" }, metricIds: [] },
          ],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "unknown-series" }));
    expect(() =>
      prepareChart(
        spec({
          points: [
            { key: "a", labelKey: "x", values: { actual: "1e6" }, metricIds: [] },
          ],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid-decimal" }));
    expect(() => prepareChart(spec({ points: [] }))).toThrowError(
      expect.objectContaining({ code: "empty-points" }),
    );
  });

  it("accepts negative and zero values without distortion", () => {
    const m = prepareChart(
      spec({
        kind: "bars",
        domain: { min: "-400", max: "400" },
        points: [
          { key: "a", labelKey: "x", values: { actual: "-250", target: "0" }, metricIds: [] },
          { key: "b", labelKey: "y", values: { actual: "0", target: "100" }, metricIds: [] },
        ],
      }),
    );
    expect(m.domain.min).toBe(-400);
    expect(m.points[0]!.values[0]!.coordinate).toBe(-250);
    expect(m.points[1]!.values[0]!.coordinate).toBe(0);
    expect(m.ticks).toContain(0);
  });

  it("resolves every example spec", () => {
    for (const example of [
      targetBarsExample,
      targetBarsAllRegionsExample,
      downtimeBarsExample,
      qualityBarsExample,
      scenarioBarsExample,
    ]) {
      const m = prepareChart(example);
      expect(m.empty).toBe(false);
      expect(m.ticks.length).toBeGreaterThan(0);
    }
  });
});

describe("chartTicks", () => {
  it("returns ascending ticks inside the domain", () => {
    const ticks = chartTicks(0, 20);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(20);
    }
  });

  it("includes the zero tick on domains spanning zero", () => {
    expect(chartTicks(-100, 100)).toContain(0);
  });
});

describe("variance helpers (exact decimal display derivations)", () => {
  it("computes absolute variance exactly", () => {
    expect(absoluteVariance("881000", "1000000")).toBe("-119000");
    expect(absoluteVariance("1240000", "1150000")).toBe("90000");
  });

  it("computes relative variance exactly and refuses a zero target", () => {
    const rel = relativeVariance("881000", "1000000");
    expect(rel).not.toBeNull();
    expect(Number(rel)).toBeCloseTo(-0.119, 6);
    expect(relativeVariance("5", "0")).toBeNull();
  });
});
