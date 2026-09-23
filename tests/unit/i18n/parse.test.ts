import { describe, expect, it } from "vitest";
import { normalizeNumericText, parseLocalizedDecimal, parseProfileFor } from "../../../packages/i18n/src/index.ts";

const ar = parseProfileFor("ar");

describe("parseLocalizedDecimal — shared strictness", () => {
  const en = parseProfileFor("en");

  it("parses plain and grouped values", () => {
    expect(parseLocalizedDecimal("42", en)).toBe("42");
    expect(parseLocalizedDecimal("-42", en)).toBe("-42");
    expect(parseLocalizedDecimal("3.14", en)).toBe("3.14");
    expect(parseLocalizedDecimal("1,234,567.89", en)).toBe("1234567.89");
    expect(parseLocalizedDecimal("-0.0004", en)).toBe("-0.0004");
    expect(parseLocalizedDecimal(".5", en)).toBe("0.5");
    expect(parseLocalizedDecimal("-.5", en)).toBe("-0.5");
  });

  it("folds -0 and trailing fractional zeros to canonical form", () => {
    expect(parseLocalizedDecimal("-0", en)).toBe("0");
    expect(parseLocalizedDecimal("-0.000", en)).toBe("0");
    expect(parseLocalizedDecimal("00042.500", en)).toBe("42.5");
    expect(parseLocalizedDecimal("0.500", en)).toBe("0.5");
  });

  it("flags ambiguous commas as ambiguous-number", () => {
    for (const bad of ["12,34", "123,45", "1,23", "1,23,456", "12,34.56"]) {
      expect(() => parseLocalizedDecimal(bad, en), bad).toThrowError(
        expect.objectContaining({ code: "ambiguous-number" }),
      );
    }
  });

  it("flags non-decimal input as invalid-number", () => {
    for (const bad of ["abc", "1.2.3", "1e5", "5-", "١٢-", "--5", "", " ", "-", "."]) {
      expect(() => parseLocalizedDecimal(bad, en), bad).toThrowError(
        expect.objectContaining({ code: "invalid-number" }),
      );
    }
  });
});

describe("parseLocalizedDecimal — Arabic profile", () => {
  it("maps Arabic-Indic digits and separators", () => {
    expect(parseLocalizedDecimal("١٢٣٤", ar)).toBe("1234");
    expect(parseLocalizedDecimal("١٬٢٣٤٬٥٦٧٫٨٩", ar)).toBe("1234567.89");
    expect(parseLocalizedDecimal("٣٫١٤", ar)).toBe("3.14");
    expect(parseLocalizedDecimal("-١٢", ar)).toBe("-12");
    expect(parseLocalizedDecimal("−١٢", ar)).toBe("-12"); // U+2212 minus
  });

  it("accepts Extended Arabic-Indic digits (U+06F0–F9)", () => {
    expect(parseLocalizedDecimal("۴۲۵", ar)).toBe("425");
  });

  it("accepts Latin digits under the Arabic profile", () => {
    expect(parseLocalizedDecimal("1,234.56", ar)).toBe("1234.56");
    expect(parseLocalizedDecimal("42", ar)).toBe("42");
  });

  it("strips bidi controls and whitespace before parsing", () => {
    expect(parseLocalizedDecimal("‎١٢٣‏", ar)).toBe("123");
    expect(parseLocalizedDecimal("  42 ", parseProfileFor("en"))).toBe("42");
    expect(parseLocalizedDecimal("١٢٣٤٥", ar)).toBe("12345");
  });

  it("ambiguous grouping still rejected in Arabic", () => {
    expect(() => parseLocalizedDecimal("١٢٬٣٤", ar)).toThrowError(
      expect.objectContaining({ code: "ambiguous-number" }),
    );
  });

  it("normalizes Arabic-Indic digits even under the English profile", () => {
    // Digit normalization is script-level; separator rules stay per-profile.
    expect(parseLocalizedDecimal("٤٢", parseProfileFor("en"))).toBe("42");
  });
});

describe("parseProfileFor", () => {
  it("maps UI locales to parse profiles", () => {
    expect(parseProfileFor("ar")).toBe("ar");
    expect(parseProfileFor("en")).toBe("en");
  });
});

describe("normalizeNumericText", () => {
  it("normalizes digits/separators without full validation", () => {
    expect(normalizeNumericText("١٢٣")).toBe("123");
    expect(normalizeNumericText("٣٫١٤")).toBe("3.14");
    expect(normalizeNumericText("١٬٢٣٤")).toBe("1,234");
    expect(normalizeNumericText("١٢٪")).toBe("12%");
  });
});
