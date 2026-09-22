import { describe, expect, it } from "vitest";
import {
  CHAPTER_SEEK,
  CHAPTER_T,
  HOLD_T,
  LOOP_MS,
  REPORT_IN_T,
  RESTART_T,
} from "./SpreadStage.tsx";

/**
 * The stage's timeline contract, checked at the constants level so a future
 * re-cut can't silently break it:
 *  - four ordered chapters fill the loop;
 *  - each chapter's seek target lands inside its own settled window;
 *  - the finished report holds ≥2.5s before the in-frame restart;
 *  - the reduced-motion frame sits inside that settled hold.
 */
describe("stage timeline", () => {
  it("defines four ordered chapters covering the loop", () => {
    expect(CHAPTER_T).toHaveLength(4);
    for (let i = 1; i < CHAPTER_T.length; i++) {
      expect(CHAPTER_T[i]!).toBeGreaterThan(CHAPTER_T[i - 1]!);
    }
    expect(CHAPTER_T[0]).toBe(0);
    expect(CHAPTER_T[CHAPTER_T.length - 1]!).toBeLessThan(LOOP_MS);
  });

  it("lands every chapter seek inside its own chapter window", () => {
    for (let i = 0; i < CHAPTER_SEEK.length; i++) {
      const end = i === CHAPTER_T.length - 1 ? LOOP_MS : CHAPTER_T[i + 1]!;
      expect(CHAPTER_SEEK[i]!, `seek ${i}`).toBeGreaterThan(CHAPTER_T[i]!);
      expect(CHAPTER_SEEK[i]!, `seek ${i}`).toBeLessThan(end);
    }
  });

  it("holds the finished report at least 2.5s before restarting", () => {
    expect(RESTART_T - REPORT_IN_T).toBeGreaterThanOrEqual(2500);
    expect(RESTART_T).toBeLessThan(LOOP_MS);
    // the restart crossfade must finish exactly at the wrap
    expect(LOOP_MS - RESTART_T).toBeGreaterThanOrEqual(500);
  });

  it("freezes reduced-motion inside the settled report hold", () => {
    expect(HOLD_T).toBeGreaterThanOrEqual(REPORT_IN_T);
    expect(HOLD_T).toBeLessThan(RESTART_T);
  });
});
