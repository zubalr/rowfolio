/**
 * Import-free constants shared by the harness, the specs and the unit tests.
 * This module must never import contracts/app code — Playwright's loader pulls
 * spec-side imports through Node ESM where JSON modules need attributes.
 */

/** Named harness scenarios — `?scenario=` values on the harness page. */
export type EvidenceScenario =
  | "revenue-gap"
  | "quality"
  | "undefined-metric"
  | "disjoint"
  | "long-sheet"
  | "malicious";

/** Hostile cell contents injected by the `malicious` scenario — must render as text. */
export const MALICIOUS_SITE = `<img src=x onerror="alert('xss')"><b>bold</b>`;
export const MALICIOUS_ID = "=cmd|'/c calc'!A1";
export const MALICIOUS_STRINGS = [MALICIOUS_SITE, MALICIOUS_ID] as const;
