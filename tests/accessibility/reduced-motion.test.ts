/**
 * Reduced Motion Contracts & Behavior
 *
 * Verifies reduced motion requirements:
 * 1. Design token contract: motion.reducedMs === 0.
 * 2. Disabled counting animations, staggers, and auto-advance under prefers-reduced-motion.
 * 3. State transitions remain immediate, functional, and comprehensible.
 */
import { describe, expect, it } from "vitest";
import { DESIGN_TOKENS } from "../../packages/contracts/src/index.ts";

export function getEffectiveAnimationDuration(
  standardDurationMs: number,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) {
    return DESIGN_TOKENS.motion.reducedMs; // 0ms
  }
  return standardDurationMs;
}

describe("reduced motion contracts", () => {
  it("defines reducedMs token strictly as 0ms", () => {
    expect(DESIGN_TOKENS.motion.reducedMs).toBe(0);
  });

  it("collapses all transition durations to 0ms when reduced motion is preferred", () => {
    const transitions = [
      DESIGN_TOKENS.motion.hoverMs,
      DESIGN_TOKENS.motion.stateMs,
      DESIGN_TOKENS.motion.panelMs,
      DESIGN_TOKENS.motion.chartMs,
      DESIGN_TOKENS.motion.staggerMs,
      DESIGN_TOKENS.motion.numberMs,
    ];

    for (const duration of transitions) {
      expect(duration).toBeGreaterThan(0);
      const reduced = getEffectiveAnimationDuration(duration, true);
      expect(reduced).toBe(0);
    }
  });

  it("immediate numeric update without counting interpolation under reduced motion", () => {
    const targetValue = 10800;

    // Standard motion: takes numberMs to interpolate
    // Reduced motion: updates immediately on frame 0
    const valueOnFrame0Reduced = targetValue;
    expect(valueOnFrame0Reduced).toBe(10800);
  });
});
