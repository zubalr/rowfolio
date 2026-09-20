/**
 * Headline figures for the hero miniature finding.
 *
 * These are the same North June values the preview derives at module init
 * from the checked-in oracle fixture; they live in their own featherweight
 * module so the hero can render on first paint while the full preview
 * payload (fixture JSON + stage + demo wiring) stays behind the lazy
 * boundary. `previewTruth.test.ts` asserts both reconcile with
 * `LANDING_TRUTH` exactly, so this cannot drift silently.
 */
import type { Decimal } from "@rowfolio/contracts";

export const MINI_TRUTH: {
  readonly revenue: Decimal;
  readonly targetGapRatio: Decimal;
} = {
  revenue: "881000",
  targetGapRatio: "0.119",
};
