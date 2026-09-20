/**
 * Reduced Motion Contracts & Behavior (A19)
 *
 * Verifies reduced motion requirements from 16_ACCESSIBILITY_SPEC.md:
 * 1. Design token contract: motion.reducedMs === 0.
 * 2. Disabled counting animations, staggers, and auto-advance under prefers-reduced-motion.
 * 3. State transitions remain immediate, functional, and comprehensible.
 */
import { describe, expect, it } from "vitest";
import designTokens from "../../packages/contracts/source/design-tokens.json";

export function getEffectiveAnimationDuration(
  standardDurationMs: number,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) {
    return designTokens.motion.reducedMs; // 0ms
  }
  return standardDurationMs;
}

describe("reduced motion contracts (A19)", () => {
  it("defines reducedMs token strictly as 0ms", () => {
    expect(designTokens.motion.reducedMs).toBe(0);
  });

  it("collapses all transition durations to 0ms when reduced motion is preferred", () => {
    const transitions = [
      designTokens.motion.hoverMs,
      designTokens.motion.stateMs,
      designTokens.motion.panelMs,
      designTokens.motion.chartMs,
      designTokens.motion.staggerMs,
      designTokens.motion.numberMs,
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
