/**
 * Chart model — turns a contract `ChartSpec` into validated, display-ready
 * geometry inputs. Everything here is pure and DOM-free.
 *
 * Truth boundary: values arrive as canonical decimal strings and are stored
 * on the model both as the original string (`value`) and as a Number used
 * ONLY for pixel geometry (`coordinate`). The model never recomputes
 * business metrics; the only derived quantities are display deltas
 * (variance/scenario change) computed through contract exact arithmetic in
 * `localization.ts`.
 */
import type { ChartSpec, Decimal } from "@rowfolio/contracts";
import {
  compareDecimal,
  divideDecimal,
  isDecimal,
  isZeroDecimal,
  subtractDecimal,
} from "@rowfolio/contracts";
import { ticks as d3Ticks } from "d3-array";
import { ChartError } from "./errors.ts";
import { decimalToNumber } from "./localization.ts";

export interface ResolvedSeries {
  id: string;
  labelKey: string;
  semantic: "observed" | "target" | "scenario" | "attention";
}

export interface ResolvedValue {
  seriesId: string;
  /** Canonical decimal from the spec, or null when the point omits it. */
  value: Decimal | null;
  /** Layout coordinate (Number). Null when value is null. */
  coordinate: number | null;
}

export interface ResolvedPoint {
  key: string;
  labelKey: string;
  metricIds: readonly string[];
  /** Values keyed by declared series id; absent series → null. */
  values: ResolvedValue[];
}

export interface ChartModel {
  spec: ChartSpec;
  series: ResolvedSeries[];
  points: ResolvedPoint[];
  /**
   * Declared (authoritative) value domain from the spec, as Numbers.
   * Display geometry may widen it for the mandatory zero baseline on bars or
   * for an out-of-domain extreme (never silently clipped); `declaredDomain`
   * always reports exactly what the contract carried.
   */
  declaredDomain: { min: number; max: number };
  /** Effective value axis domain used for geometry. */
  domain: { min: number; max: number };
  /** Nice tick values inside `domain`, ascending. */
  ticks: number[];
  /** True when every value across every series is null. */
  empty: boolean;
}

const BAR_LIKE = new Set(["bars", "quality-bars", "scenario-bars", "target-bars", "distribution"]);

/**
 * Validates and resolves a ChartSpec. Throws ChartError on contract
 * violations; callers pass specs that already validate against the wire
 * schema, so failures here indicate a producer bug, not user data.
 */
export function prepareChart(spec: ChartSpec): ChartModel {
  if (!spec.points.length) {
    throw new ChartError("empty-points", `Chart ${spec.id} declares no points`, { id: spec.id });
  }
  if (!isDecimal(spec.domain.min) || !isDecimal(spec.domain.max)) {
    throw new ChartError("invalid-domain", `Chart ${spec.id} domain must be canonical decimals`, {
      min: spec.domain.min,
      max: spec.domain.max,
    });
  }
  if (compareDecimal(spec.domain.min, spec.domain.max) > 0) {
    throw new ChartError("invalid-domain", `Chart ${spec.id} domain min exceeds max`, {
      min: spec.domain.min,
      max: spec.domain.max,
    });
  }
  const series: ResolvedSeries[] = spec.series.map((s) => ({ ...s }));
  const seriesIds = new Set(series.map((s) => s.id));
  let anyValue = false;
  let minValue = Infinity;
  let maxValue = -Infinity;
  const points: ResolvedPoint[] = spec.points.map((p) => {
    const values: ResolvedValue[] = series.map((s) => {
      const raw = p.values[s.id];
      if (raw === undefined || raw === null) return { seriesId: s.id, value: null, coordinate: null };
      if (!isDecimal(raw)) {
        throw new ChartError("invalid-decimal", `Chart ${spec.id} point ${p.key} series ${s.id} is not a decimal`, {
          point: p.key,
          series: s.id,
        });
      }
      const n = decimalToNumber(raw);
      anyValue = true;
      if (n < minValue) minValue = n;
      if (n > maxValue) maxValue = n;
      return { seriesId: s.id, value: raw, coordinate: n };
    });
    for (const key of Object.keys(p.values)) {
      if (!seriesIds.has(key)) {
        throw new ChartError("unknown-series", `Chart ${spec.id} point ${p.key} references undeclared series ${key}`, {
          point: p.key,
          series: key,
        });
      }
    }
    return { key: p.key, labelKey: p.labelKey, metricIds: p.metricIds, values };
  });

  const declaredDomain = {
    min: decimalToNumber(spec.domain.min),
    max: decimalToNumber(spec.domain.max),
  };
  let domain = { ...declaredDomain };
  if (BAR_LIKE.has(spec.kind)) {
    // Zero baseline is mandatory for bars (05_MOTION_SPEC / 11_VISUALIZATION_SPEC).
    if (domain.min > 0) domain = { ...domain, min: 0 };
    if (domain.max < 0) domain = { ...domain, max: 0 };
  }
  // An extreme point outside the declared domain is never silently clipped:
  // the display domain widens to cover it and the axis shows the true extent.
  if (anyValue) {
    if (minValue < domain.min) domain = { ...domain, min: minValue };
    if (maxValue > domain.max) domain = { ...domain, max: maxValue };
  }
  if (domain.min === domain.max) {
    // Degenerate domain (single value): open a visible window around it.
    const pad = domain.min === 0 ? 1 : Math.abs(domain.min) * 0.1;
    domain = { min: domain.min - pad, max: domain.max + pad };
  }
  return {
    spec,
    series,
    points,
    declaredDomain,
    domain,
    ticks: chartTicks(domain.min, domain.max),
    empty: !anyValue,
  };
}

/**
 * Nice axis ticks strictly within the domain. Bars guarantee the zero tick is
 * present so the baseline is labeled; endpoints are included when they are
 * already "nice" per the d3 step.
 */
export function chartTicks(min: number, max: number, count = 4): number[] {
  if (!(min < max)) return [min];
  const raw = d3Ticks(min, max, count).filter((t) => t >= min && t <= max);
  const out = new Set(raw);
  if (min < 0 && max > 0) out.add(0);
  if (out.size === 0) out.add(min).add(max);
  return [...out].sort((a, b) => a - b);
}

/** Point keys in render order (declaration order == display order, LTR). */
export function pointKeys(model: ChartModel): string[] {
  return model.points.map((p) => p.key);
}

/**
 * Exact signed variance helpers for the evidence table. These are display
 * derivations over spec values, expressed via contract decimal arithmetic.
 */
export function absoluteVariance(actual: Decimal, target: Decimal): Decimal {
  return subtractDecimal(actual, target);
}

export function relativeVariance(actual: Decimal, target: Decimal): Decimal | null {
  // A ratio against a zero target is undefined, never silently coerced.
  if (isZeroDecimal(target)) return null;
  return divideDecimal(subtractDecimal(actual, target), target);
}
