/**
 * Token parity: the TypeScript view must equal contracts/design-tokens.json
 * v1.0.0 literally. If this file fails, the contract moved — update tokens.ts
 * and styles/tokens.css together, and check validation/contrast.json pairs.
 */
import { describe, expect, it } from "vitest";
import { color, layout, motion, plateLabel, radius, spacing, typePx } from "./tokens.ts";

describe("design tokens", () => {
  it("match contract color values", () => {
    expect(color).toEqual({
      ink: "#10191E",
      paper: "#F5F7F8",
      surface: "#FFFFFF",
      muted: "#54666E",
      rule: "#D9E0E4",
      data: "#2B50E8",
      dataTint30: "#C6D1FF",
      attention: "#E04E1A",
      negative: "#A33224",
      positive: "#0E8F7E",
      positiveText: "#116B63",
      scenario: "#B96F00",
      scenarioText: "#946000",
    });
  });

  it("match contract spacing scale", () => {
    expect([...spacing]).toEqual([4, 8, 12, 16, 24, 32, 48, 64, 96]);
  });

  it("match contract radius tokens", () => {
    expect(radius).toEqual({ control: 8, panel: 16, dialog: 20, pill: 999 });
  });

  it("match contract layout tokens", () => {
    expect(layout.maxWidth).toBe(1320);
    expect(layout.desktopGutter).toBe(48);
    expect(layout.tabletGutter).toBe(24);
    expect(layout.mobileGutter).toBe(16);
    expect(layout.evidenceWidth).toBe(560);
  });

  it("match contract motion tokens", () => {
    expect(motion).toEqual({
      hoverMs: 120,
      stateMs: 160,
      panelMs: 240,
      chartMs: 220,
      staggerMs: 40,
      firstResultsMs: 180,
      numberMs: 240,
      progressMs: 120,
      reducedMs: 0,
    });
  });

  it("match contract plate label", () => {
    expect(plateLabel).toEqual({
      sizePx: 11.5,
      family: "code",
      weight: 600,
      transform: "uppercase",
      trackingEm: 0.12,
    });
  });

  it("match contract type ramp", () => {
    expect(typePx).toEqual({
      hero: 64,
      heroMobile: 42,
      page: 36,
      section: 32,
      body: 16,
      small: 13,
      metric: 40,
      metricMobile: 30,
      arabicHero: 54,
      arabicHeroMobile: 36,
      arabicSection: 30,
      arabicBody: 17,
      arabicSmall: 14,
    });
  });
});
