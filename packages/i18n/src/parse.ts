import type { Decimal, Locale } from "@rowfolio/contracts";
import { normalizeDecimalString } from "@rowfolio/contracts";
import { stripBidiControls } from "./bidi.ts";
import { I18nError } from "./errors.ts";

/**
 * Parsing is the strict inverse of formatting: an explicit per-locale profile,
 * never a guess. `1,234` is only meaningful inside a declared profile — a bare
 * comma is ambiguous, so ambiguous shapes fail with `ambiguous-number` rather
 * than being silently reinterpreted (see 08_ANALYSIS_ENGINE_SPEC).
 */

export type ParseProfile = "en" | "ar";

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

function normalizeDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Normalizes pasted/typed input: Arabic-Indic and Extended Arabic-Indic digits
 * become ASCII digits, `٫` (U+066B) / `٬` (U+066C) become `.` / `,`, Unicode
 * minus/dashes become `-`, `٪` becomes `%`, and whitespace plus bidi controls
 * are stripped.
 */
export function normalizeNumericText(text: string): string {
  let out = stripBidiControls(normalizeDigits(text));
  out = out.replace(/٫/g, ".").replace(/٬/g, ",");
  out = out.replace(/[−–—]/g, "-");
  out = out.replace(/[ \u00A0\u2000-\u200A\u202F\u3000]/g, "");
  out = out.replace(/٪/g, "%");
  return out;
}

function isGrouped(value: string): boolean {
  return /^-?\d{1,3}(,\d{3})+$/.test(value);
}

function isPlainDecimal(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value) || /^-?\.\d+$/.test(value);
}

/**
 * Canonicalizes to contract decimal form: ASCII digits, `.` separator, no
 * grouping, no leading zeros, `-0` normalized to `0`. Fraction digits are kept
 * verbatim (authored scale is meaningful).
 */
function canonicalize(value: string): Decimal {
  const negative = value.startsWith("-");
  const body = (negative ? value.slice(1) : value).replace(/,/g, "");
  const dot = body.indexOf(".");
  let integer = dot === -1 ? body : body.slice(0, dot);
  const fraction = dot === -1 ? "" : body.slice(dot + 1);
  integer = integer.replace(/^0+(?=\d)/, "");
  if (integer === "") {
    integer = "0";
  }
  const isZero = /^0*$/.test(integer) && /^0*$/.test(fraction);
  const result = `${negative && !isZero ? "-" : ""}${integer}${fraction.length > 0 ? `.${fraction}` : ""}`;
  // Contract canonical form: minimal scale, `-0` folded.
  return normalizeDecimalString(result) as Decimal;
}

/**
 * Parses localized numeric text under an explicit profile into a canonical
 * decimal string. Grouping separators must appear in valid 3-digit groups when
 * present; a lone comma or separator shapes that could mean two different
 * values raise `ambiguous-number`. Exponents, currency symbols, percent signs
 * and stray characters raise `invalid-number`.
 */
export function parseLocalizedDecimal(text: string, profile: ParseProfile): Decimal {
  if (profile !== "en" && profile !== "ar") {
    throw new I18nError("invalid-locale", `Unknown parse profile: ${String(profile)}`, { profile: String(profile) });
  }
  const normalized = normalizeNumericText(text);
  if (normalized.length === 0 || normalized === "-" || normalized === ".") {
    throw new I18nError("invalid-number", "Empty numeric input", { input: text });
  }
  if (/[^0-9,.-]/.test(normalized)) {
    throw new I18nError("invalid-number", "Unsupported characters in numeric input", { input: text });
  }
  const minusCount = (normalized.match(/-/g) ?? []).length;
  if (minusCount > 1 || (minusCount === 1 && !normalized.startsWith("-"))) {
    throw new I18nError("invalid-number", "Misplaced sign in numeric input", { input: text });
  }
  if (normalized.includes(",") && normalized.includes(".")) {
    // Both separators present: unambiguous only as `1,234.56` (dot after the last comma).
    if (!/^-?\d{1,3}(,\d{3})*\.\d+$/.test(normalized)) {
      throw new I18nError("ambiguous-number", `Ambiguous separators in ${JSON.stringify(text)}`, { input: text });
    }
    return canonicalize(normalized);
  }
  if (normalized.includes(",")) {
    if (!isGrouped(normalized)) {
      throw new I18nError("ambiguous-number", `Ambiguous grouping in ${JSON.stringify(text)}`, { input: text });
    }
    return canonicalize(normalized);
  }
  const dotCount = (normalized.match(/\./g) ?? []).length;
  if (dotCount > 1) {
    throw new I18nError("invalid-number", "Multiple decimal separators in numeric input", { input: text });
  }
  if (!isPlainDecimal(normalized)) {
    throw new I18nError("invalid-number", `Not a decimal number: ${JSON.stringify(text)}`, { input: text });
  }
  return canonicalize(normalized);
}

/** The parse profile matching a UI locale. */
export function parseProfileFor(locale: Locale): ParseProfile {
  return locale === "ar" ? "ar" : "en";
}
