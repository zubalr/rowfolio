import { describe, expect, it } from "vitest";
import {
  CHAPTER_SEEK,
  CHAPTER_T,
  HOLD_T,
  LOOP_MS,
  REPORT_IN_T,
  stageNeedsReveal,
} from "./SpreadStage.tsx";

/**
 * The stage's timeline contract, checked at the constants level so a future
 * re-cut can't silently break it:
 *  - six ordered chapters fill the loop (result, workbook, checks, chart,
 *    finding, report) inside the 25-35s contract window;
 *  - each chapter's seek target lands inside its own settled window;
 *  - the finished report holds ≥3.5s through the wrap — the loop opens and
 *    closes on the same opaque scene so the seam never blinks;
 *  - the reduced-motion frame sits inside that settled hold;
 *  - explicit reveal actions scroll only when the frame's beginning is
 *    actually out of view — autoplay and in-view taps never hijack scroll.
 */
describe("stage timeline", () => {
  it("defines six ordered chapters covering the loop", () => {
    expect(CHAPTER_T).toHaveLength(6);
    for (let i = 1; i < CHAPTER_T.length; i++) {
      expect(CHAPTER_T[i]!).toBeGreaterThan(CHAPTER_T[i - 1]!);
    }
    expect(CHAPTER_T[0]).toBe(0);
    expect(CHAPTER_T[CHAPTER_T.length - 1]!).toBeLessThan(LOOP_MS);
  });

  it("keeps the full loop inside the 25-35s contract window", () => {
    expect(LOOP_MS).toBeGreaterThanOrEqual(25000);
    expect(LOOP_MS).toBeLessThanOrEqual(35000);
  });

  it("lands every chapter seek inside its own chapter window", () => {
    expect(CHAPTER_SEEK).toHaveLength(CHAPTER_T.length);
    for (let i = 0; i < CHAPTER_SEEK.length; i++) {
      const end = i === CHAPTER_T.length - 1 ? LOOP_MS : CHAPTER_T[i + 1]!;
      expect(CHAPTER_SEEK[i]!, `seek ${i}`).toBeGreaterThan(CHAPTER_T[i]!);
      expect(CHAPTER_SEEK[i]!, `seek ${i}`).toBeLessThan(end);
    }
  });

  it("holds the finished report at least 3.5s through the wrap", () => {
    // the report opens AND closes the loop: the hold is one continuous
    // interval from REPORT_IN_T to the wrap, never a blink.
    expect(LOOP_MS - REPORT_IN_T).toBeGreaterThanOrEqual(3500);
    expect(REPORT_IN_T).toBeGreaterThan(CHAPTER_T[CHAPTER_T.length - 1]!);
  });

  it("freezes reduced-motion inside the settled report hold", () => {
    expect(HOLD_T).toBeGreaterThanOrEqual(REPORT_IN_T);
    expect(HOLD_T).toBeLessThan(LOOP_MS);
  });
});

describe("stageNeedsReveal", () => {
  it("reveals when the scene's beginning is clipped above the viewport", () => {
    // the owner-reproduced failure: Replay then Pause left frame y=-262.
    expect(stageNeedsReveal(-262, 844)).toBe(true);
    expect(stageNeedsReveal(-1, 844)).toBe(true);
  });

  it("reveals when the frame is fully below the viewport", () => {
    expect(stageNeedsReveal(844, 844)).toBe(true);
    expect(stageNeedsReveal(1200, 844)).toBe(true);
  });

  it("leaves a frame alone when its beginning is already visible", () => {
    expect(stageNeedsReveal(0, 844)).toBe(false);
    expect(stageNeedsReveal(250, 844)).toBe(false);
    expect(stageNeedsReveal(843, 844)).toBe(false);
  });
});
