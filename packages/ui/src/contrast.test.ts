/**
 * Contrast verification (WCAG 2.x sRGB).
 *
 * Reproduces every pair in the published contrast-validation pairs and asserts
 * the on-ink tints stay within their declared usage. A regression here means a
 * token or component color pairing changed — fix the pairing, not the test.
 */
import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast.ts";
import { color, colorOnInk } from "./tokens.ts";

// Expected ratios from the contract design-token palette (verified
// WCAG relative luminance on sRGB). Tolerance ±0.02 covers float rounding.
const CONTRACT_PAIRS = [
  { fg: color.ink, bg: color.paper, ratio: 13.329, normalAA: true },
  { fg: color.muted, bg: color.paper, ratio: 5.685, normalAA: true },
  { fg: color.data, bg: color.paper, ratio: 5.633, normalAA: true },
  { fg: color.negative, bg: color.paper, ratio: 6.287, normalAA: true },
  { fg: color.positive, bg: color.paper, ratio: 5.777, normalAA: true },
  { fg: color.scenario, bg: color.paper, ratio: 4.859, normalAA: true },
  { fg: color.surface, bg: color.data, ratio: 6.136, normalAA: true },
  { fg: color.surface, bg: color.ink, ratio: 14.517, normalAA: true },
  // Vermilion on paper is below 4.5 — lawful for large text/graphics only.
  { fg: color.attention, bg: color.paper, ratio: 4.24, normalAA: false },
] as const;

describe("contrastRatio", () => {
  it("reproduces the contract contrast table", () => {
    for (const p of CONTRACT_PAIRS) {
      const ratio = contrastRatio(p.fg, p.bg);
      expect(ratio).toBeCloseTo(p.ratio, 2);
      expect(ratio >= 4.5).toBe(p.normalAA);
      expect(ratio >= 3).toBe(true);
    }
  });

  it("computes 21:1 for black on white and 1:1 for identity", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#2855D9", "#2855D9")).toBeCloseTo(1, 5);
  });

  it("keeps dark-surface text tints readable (normal text AA on ink)", () => {
    expect(contrastRatio(colorOnInk.text, color.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colorOnInk.muted, color.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colorOnInk.data, color.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colorOnInk.attention, color.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colorOnInk.positive, color.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colorOnInk.scenario, color.ink)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the on-ink raised surface and rules non-text-grade only", () => {
    // Rules/surfaces are graphical: they must not pretend to text contrast,
    // but should still clear 3:1 where they carry meaning (focus, edges).
    expect(contrastRatio(colorOnInk.rule, color.ink)).toBeGreaterThanOrEqual(1.5);
    expect(contrastRatio(colorOnInk.surface, color.ink)).toBeGreaterThanOrEqual(1.1);
  });

  it("verifies paper text stays AA on the primary (ink) button", () => {
    expect(contrastRatio(color.surface, color.ink)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("relativeLuminance", () => {
  it("rejects malformed colors", () => {
    expect(() => relativeLuminance("blue")).toThrow(/hex/);
    expect(() => relativeLuminance("#12345")).toThrow(/hex/);
  });
});
