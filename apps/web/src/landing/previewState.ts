/**
 * Preview session state — the small reducer the landing demo surface and
 * the DemoController both dispatch into. Pure: no DOM, no timers; the same
 * action identifiers power manual clicks and guide steps.
 */
import type { Decimal } from "@rowfolio/contracts";

export interface PreviewState {
  /** Findings card revealed (post "Explore" intent or guide findings step). */
  readonly revealed: boolean;
  readonly evidenceOpen: boolean;
  /** Scenario cost-change ratio (canonical decimal in [−0.2, 0.3]). */
  readonly scenarioRatio: Decimal;
  readonly briefingReady: boolean;
}

export const PREVIEW_IDLE: PreviewState = {
  revealed: false,
  evidenceOpen: false,
  scenarioRatio: "0",
  briefingReady: false,
};

export type PreviewAction =
  | { readonly type: "reveal" }
  | { readonly type: "open-evidence" }
  | { readonly type: "close-evidence" }
  | { readonly type: "toggle-evidence" }
  | { readonly type: "set-scenario"; readonly ratio: Decimal }
  | { readonly type: "prepare-briefing" }
  | { readonly type: "reset" };

export function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case "reveal":
      return { ...state, revealed: true };
    case "open-evidence":
      return { ...state, revealed: true, evidenceOpen: true };
    case "close-evidence":
      return { ...state, evidenceOpen: false };
    case "toggle-evidence":
      return { ...state, revealed: true, evidenceOpen: !state.evidenceOpen };
    case "set-scenario":
      return { ...state, revealed: true, scenarioRatio: action.ratio };
    case "prepare-briefing":
      return { ...state, revealed: true, briefingReady: true };
    case "reset":
      return PREVIEW_IDLE;
  }
}
