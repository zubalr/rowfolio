/**
 * WCAG 2.2 AA Contrast & Palette Verification
 *
 * Mathematically verifies sRGB relative luminance and contrast ratios
 * for the Paper / Ink / Cobalt design token palette.
 *
 * Rules:
 * - Normal text WCAG AA: >= 4.5:1
 * - Large text (>=18pt or >=14pt bold) / graphical objects: >= 3.0:1
 * - Attention shares the negative role (#A33224) since contract v3 retired the
 *   vermilion accent; it is now text-safe on Paper at ~7:1.
 */
import { describe, expect, it } from "vitest";
import { DESIGN_TOKENS } from "../../packages/contracts/src/index.ts";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0]! + clean[0]!, 16),
      g: parseInt(clean[1]! + clean[1]!, 16),
      b: parseInt(clean[2]! + clean[2]!, 16),
    };
  }
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function channelLuminance(channel255: number): number {
  const s = channel255 / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: RGB): number {
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

export function contrastRatio(rgb1: RGB, rgb2: RGB): number {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("WCAG 2.2 AA token contrast ratios", () => {
  const colors = DESIGN_TOKENS.color;

  const colorRgb = {
    ink: hexToRgb(colors.ink),
    paper: hexToRgb(colors.paper),
    surface: hexToRgb(colors.surface),
    muted: hexToRgb(colors.muted),
    rule: hexToRgb(colors.rule),
    data: hexToRgb(colors.data),
    attention: hexToRgb(colors.attention),
    negative: hexToRgb(colors.negative),
    positive: hexToRgb(colors.positive),
    positiveText: hexToRgb(colors.positiveText),
    scenario: hexToRgb(colors.scenario),
    scenarioText: hexToRgb(colors.scenarioText),
  };

  it("ink on paper exceeds 4.5:1 (high contrast body text)", () => {
    const ratio = contrastRatio(colorRgb.ink, colorRgb.paper);
    expect(ratio).toBeGreaterThanOrEqual(13.0);
  });

  it("muted text on paper exceeds 4.5:1 for normal text AA", () => {
    const ratio = contrastRatio(colorRgb.muted, colorRgb.paper);
    expect(ratio).toBeGreaterThanOrEqual(5.5);
  });

  it("primary data cobalt on paper exceeds 4.5:1 for normal text AA", () => {
    const ratio = contrastRatio(colorRgb.data, colorRgb.paper);
    expect(ratio).toBeGreaterThanOrEqual(5.5);
  });

  it("negative text on paper exceeds 4.5:1 for normal text AA", () => {
    const ratio = contrastRatio(colorRgb.negative, colorRgb.paper);
    expect(ratio).toBeGreaterThanOrEqual(6.0);
  });

  it("positive teal is graphical-only; its text variant is AA", () => {
    expect(contrastRatio(colorRgb.positive, colorRgb.paper)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(colorRgb.positiveText, colorRgb.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it("scenario amber is graphical-only; its text variant is AA", () => {
    expect(contrastRatio(colorRgb.scenario, colorRgb.paper)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(colorRgb.scenarioText, colorRgb.paper)).toBeGreaterThanOrEqual(4.5);
  });

  it("surface on ink exceeds 4.5:1 for dark evidence register", () => {
    const ratio = contrastRatio(colorRgb.surface, colorRgb.ink);
    expect(ratio).toBeGreaterThanOrEqual(14.0);
  });

  it("surface on data cobalt exceeds 4.5:1 for badges and chips", () => {
    const ratio = contrastRatio(colorRgb.surface, colorRgb.data);
    expect(ratio).toBeGreaterThanOrEqual(6.0);
  });

  it("attention (negative role) on paper passes normal text AA (>=4.5:1)", () => {
    const ratio = contrastRatio(colorRgb.attention, colorRgb.paper);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
