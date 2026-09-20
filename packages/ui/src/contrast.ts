/**
 * WCAG 2.x sRGB relative-luminance contrast math.
 *
 * Pure, dependency-free and shared by the unit suite (`contrast.test.ts`,
 * which reproduces every pair in the handoff's validation/contrast.json) so a
 * future token edit that breaks a checked pair fails the build rather than
 * shipping an unreadable combination.
 */

export function srgbChannel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a 6-digit hex color ("#RRGGBB"). */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) {
    throw new UiColorError(`Expected 6-digit hex color, received ${hex}`);
  }
  const n = parseInt(m[1]!, 16);
  const r = srgbChannel((n >> 16) & 0xff);
  const g = srgbChannel((n >> 8) & 0xff);
  const b = srgbChannel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors, in [1, 21]. */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Typed error for invalid token/color input. */
export class UiColorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UiColorError";
  }
}

export interface ContrastPair {
  foreground: string;
  background: string;
  /** Minimum acceptable ratio for the pair's usage. */
  minRatio: number;
  usage: "normal-text" | "large-text" | "graphical";
}

/**
 * Checked role pairs (source: validation/contrast.json, contract v1.0.0) plus
 * the dark evidence surface tints. `attention`/`paper` at 4.24:1 is registered
 * as `large-text` only — normal-size vermilion text on paper is forbidden by
 * the design spec; components must use `negative` for text-grade red.
 */
export const checkedPairs: readonly ContrastPair[] = [
  { foreground: "ink", background: "paper", minRatio: 4.5, usage: "normal-text" },
  { foreground: "muted", background: "paper", minRatio: 4.5, usage: "normal-text" },
  { foreground: "data", background: "paper", minRatio: 4.5, usage: "normal-text" },
  { foreground: "negative", background: "paper", minRatio: 4.5, usage: "normal-text" },
  { foreground: "positive", background: "paper", minRatio: 4.5, usage: "normal-text" },
  { foreground: "scenario", background: "paper", minRatio: 4.5, usage: "normal-text" },
  { foreground: "attention", background: "paper", minRatio: 3.0, usage: "large-text" },
  { foreground: "surface", background: "data", minRatio: 4.5, usage: "normal-text" },
  { foreground: "surface", background: "ink", minRatio: 4.5, usage: "normal-text" },
  { foreground: "ink", background: "surface", minRatio: 4.5, usage: "normal-text" },
  { foreground: "muted", background: "surface", minRatio: 4.5, usage: "normal-text" },
];
