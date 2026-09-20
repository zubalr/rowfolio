/**
 * D3 scale adapters — the only D3 surface the charts use. Scales produce
 * display coordinates from the model's resolved numbers; React still owns
 * every DOM node (no d3-selection mutation of rendered output).
 */
import { scaleBand, scaleLinear, scalePoint } from "d3-scale";

export function valueScale(domain: { min: number; max: number }, range: [number, number]) {
  return scaleLinear().domain([domain.min, domain.max]).range(range).clamp(false);
}

export function categoryScale(keys: readonly string[], range: [number, number], padding = 0.28) {
  return scaleBand().domain(keys).range(range).paddingInner(padding).paddingOuter(padding / 2);
}

export function ordinalPosition(keys: readonly string[], range: [number, number], padding = 0.5) {
  return scalePoint().domain(keys).range(range).padding(padding);
}

/** Band center helper for labels/markers (band scale has no center method). */
export function bandCenter(scale: (k: string) => number | undefined, bandwidth: number) {
  return (key: string): number => (scale(key) ?? 0) + bandwidth / 2;
}
