import { describe, expect, it } from "vitest";
import { createFormatters } from "../../../packages/i18n/src/index.ts";

const en = createFormatters("en-US-u-nu-latn");
const ar = createFormatters("ar-QA-u-nu-arab");

describe("formatNumber — digit systems", () => {
  it("English uses Latin digits with grouping", () => {
    expect(en.formatNumber("1234567.89")).toBe("1,234,567.89");
    expect(en.formatNumber("1234567.89", { useGrouping: false })).toBe("1234567.89");
  });

  it("Arabic default uses Arabic-Indic digits", () => {
    const out = ar.formatNumber("1234567.89");
    expect(out).toBe("١٬٢٣٤٬٥٦٧٫٨٩");
    expect(/[٠-٩]/.test(out)).toBe(true);
    expect(/[0-9]/.test(out)).toBe(false);
  });

  it("Arabic + Latin digits preference produces Latin digits", () => {
    const arLatn = createFormatters("ar-QA-u-nu-latn");
    expect(arLatn.formatNumber("1234567.89")).toBe("1,234,567.89");
  });

  it("rejects invalid numbering systems", () => {
    expect(() => createFormatters("en-US-u-nu-nope")).toThrowError(
      expect.objectContaining({ code: "invalid-numbering-system" }),
    );
  });
});

describe("formatNumber — scale and exactness", () => {
  it("rounds half-up into integer digits without binary error", () => {
    expect(en.formatNumber("0.005", { maxFractionDigits: 2 })).toBe("0.01");
    expect(en.formatNumber("2.675", { maxFractionDigits: 2 })).toBe("2.68");
    expect(en.formatNumber("9.995", { maxFractionDigits: 2 })).toBe("10.00");
    expect(en.formatNumber("-2.675", { maxFractionDigits: 2 })).toBe("-2.68");
  });

  it("min/max fraction digits pad and truncate", () => {
    expect(en.formatNumber("42", { minFractionDigits: 2, maxFractionDigits: 2 })).toBe("42.00");
    expect(en.formatNumber("42.5678", { maxFractionDigits: 2 })).toBe("42.57");
    expect(en.formatNumber("42.5", { minFractionDigits: 3 })).toBe("42.500");
  });

  it("keeps full authored precision by default", () => {
    expect(en.formatNumber("12345678901234567890.25")).toBe("12,345,678,901,234,567,890.25");
    expect(en.formatNumber("0.30000000000000000004")).toBe("0.30000000000000000004");
  });

  it("zero-after-rounding respects signDisplay like Intl", () => {
    // auto keeps the minus on a rounded-to-zero negative (matches Intl);
    // exceptZero suppresses it.
    expect(en.formatNumber("-0.0004", { maxFractionDigits: 2 })).toBe("-0.00");
    expect(en.formatNumber("-0.0004", { maxFractionDigits: 2, signDisplay: "exceptZero" })).toBe("0.00");
  });

  it("signDisplay always/never", () => {
    expect(en.formatNumber("5", { signDisplay: "always" })).toBe("+5");
    expect(en.formatNumber("-5", { signDisplay: "never" })).toBe("5");
    expect(en.formatNumber("-5")).toBe("-5");
  });
});

describe("formatInteger / formatPercent / formatCurrency", () => {
  it("formatInteger rejects fractional decimals", () => {
    expect(() => en.formatInteger("1.5")).toThrowError(
      expect.objectContaining({ code: "invalid-decimal" }),
    );
    expect(en.formatInteger("42")).toBe("42");
  });

  it("percent shifts the decimal point exactly", () => {
    expect(en.formatPercent("0.352")).toBe("35.2%");
    expect(en.formatPercent("0.121", { minFractionDigits: 1, maxFractionDigits: 1 })).toBe("12.1%");
    expect(en.formatPercent("-0.0425", { maxFractionDigits: 1 })).toBe("-4.3%");
    // ar-QA percent carries the ALM bidi mark after ٪ — required for correct
    // bidi ordering, so it is preserved verbatim.
    const arPct = ar.formatPercent("0.352");
    expect(arPct.replace(/؜/g, "")).toBe("٣٥٫٢٪");
    expect(arPct).toContain("؜");
    // 0.5 percent: -0.005*100 = -0.5 → -0.5%
    expect(en.formatPercent("-0.005")).toBe("-0.5%");
  });

  it("currency formats with the confirmed code regardless of locale", () => {
    expect(en.formatCurrency("1634200", "USD", { minFractionDigits: 2 })).toBe("$1,634,200.00");
    const arUsd = ar.formatCurrency("1634200", "USD", { minFractionDigits: 2 });
    expect(arUsd).toContain("US$");
    expect(arUsd).toContain("١٬٦٣٤٬٢٠٠٫٠٠");
  });

  it("rejects unsupported currency codes", () => {
    expect(() => en.formatCurrency("1", "XX")).toThrowError(
      expect.objectContaining({ code: "invalid-currency" }),
    );
    expect(en.formatCurrency("1", "usd", { minFractionDigits: 2 })).toBe("$1.00");
  });

  it("rejects malformed decimals", () => {
    for (const bad of ["abc", "1..2", "-0", "1e5", "", "NaN", "Infinity", " 5"]) {
      expect(() => en.formatNumber(bad)).toThrowError(
        expect.objectContaining({ code: "invalid-decimal" }),
      );
    }
  });
});

describe("formatList", () => {
  it("joins list items per locale", () => {
    expect(en.formatList(["Revenue", "Cost", "Margin"])).toBe("Revenue, Cost, and Margin");
    expect(ar.formatList(["الإيرادات", "التكاليف"])).toBe("الإيرادات والتكاليف");
  });
});
