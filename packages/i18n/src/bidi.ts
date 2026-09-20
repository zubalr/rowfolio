import type { Locale } from "@rowfolio/contracts";

export type Direction = "ltr" | "rtl";

/** Unicode bidirectional control characters used for isolation. */
export const BIDI = {
  LRI: "\u2066", // U+2066 LEFT-TO-RIGHT ISOLATE
  RLI: "\u2067", // U+2067 RIGHT-TO-LEFT ISOLATE
  FSI: "\u2068", // U+2068 FIRST STRONG ISOLATE
  PDI: "\u2069", // U+2069 POP DIRECTIONAL ISOLATE
  LRM: "\u200E", // U+200E LEFT-TO-RIGHT MARK
  RLM: "\u200F", // U+200F RIGHT-TO-LEFT MARK
  ALM: "\u061C", // U+061C ARABIC LETTER MARK
} as const;

/** Base paragraph/layout direction of a UI locale. */
export function directionOf(locale: Locale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

export function isRtl(locale: Locale): boolean {
  return directionOf(locale) === "rtl";
}

/**
 * Wraps text in LRI…PDI: renders it left-to-right inside any surrounding
 * direction. Use for Latin identifiers, formulas, signed numeric tokens, ISO
 * dates and source references — these stay LTR islands inside RTL prose.
 */
export function isolateLtr(text: string): string {
  return `${BIDI.LRI}${text}${BIDI.PDI}`;
}

/** Wraps text in RLI…PDI. */
export function isolateRtl(text: string): string {
  return `${BIDI.RLI}${text}${BIDI.PDI}`;
}

/**
 * Wraps text in FSI…PDI: direction is inferred from the text's first strong
 * character — the string equivalent of `dir="auto"`. Use for user-authored
 * values (sheet names, category labels, header cells) whose script is unknown.
 * Source values are never translated or rewritten; isolation only protects
 * their display order.
 */
export function isolateAuto(text: string): string {
  return `${BIDI.FSI}${text}${BIDI.PDI}`;
}

/**
 * Element props for an LTR-isolated island: `<bdi {...ltrIsolateProps()}>`.
 * Equivalent to `<bdi dir="ltr">`; consumers choose the element.
 */
export function ltrIsolateProps(): { readonly dir: "ltr" } {
  return { dir: "ltr" };
}

/** Element props equivalent to `<bdi>` / `dir="auto"` for user-authored text. */
export function autoIsolateProps(): { readonly dir: "auto" } {
  return { dir: "auto" };
}

/** Heuristic: does the string contain RTL-script characters? */
export function containsRtl(text: string): boolean {
  return /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(text);
}

const BIDI_CONTROL_CHARS = new Set<string>(Object.values(BIDI));

/**
 * Removes bidi control/format characters. Used when parsing numeric input so
 * pasted values carrying isolation marks still parse.
 */
export function stripBidiControls(text: string): string {
  let out = "";
  for (const ch of text) {
    if (!BIDI_CONTROL_CHARS.has(ch)) {
      out += ch;
    }
  }
  return out;
}
