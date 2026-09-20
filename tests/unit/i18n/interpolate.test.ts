import { describe, expect, it } from "vitest";
import { createI18n, interpolate } from "../../../packages/i18n/src/index.ts";
import { I18nError } from "../../../packages/i18n/src/index.ts";

describe("interpolate", () => {
  it("replaces placeholders in order", () => {
    expect(interpolate("Hello {name}, you have {count} items", { name: "Sara", count: 3 }, "k")).toBe(
      "Hello Sara, you have 3 items",
    );
  });

  it("inserts values as plain text — no HTML interpretation", () => {
    expect(interpolate("{value}", { value: "<b>bold</b>" }, "k")).toBe("<b>bold</b>");
    // callers rendering to DOM must treat the result as text; the placeholder
    // characters pass through verbatim so markup is never honored
  });

  it("collects all missing placeholders and throws missing-placeholder", () => {
    let thrown: unknown;
    try {
      interpolate("{a} and {b}", { a: "1" }, "key.a");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(I18nError);
    expect((thrown as I18nError).code).toBe("missing-placeholder");
    expect((thrown as I18nError).details?.["missing"]).toEqual(["b"]);
    expect((thrown as I18nError).details?.["key"]).toBe("key.a");
  });

  it("ignores params not referenced by the template", () => {
    expect(interpolate("{a}", { a: "x", extra: "y" }, "k")).toBe("x");
  });

  it("leaves malformed braces untouched", () => {
    expect(interpolate("{0} {} {a-b}", {}, "k")).toBe("{0} {} {a-b}");
  });
});

describe("t()", () => {
  const i18n = createI18n({ locale: "en" });

  it("translates a key with placeholders", () => {
    expect(i18n.t("evidence.more", { start: 1, end: 5, total: 12 })).toBe("Rows 1–5 of 12");
    expect(i18n.t("scenario.scope", { scope: "all rows" })).toBe("Scenario scope: all rows");
  });

  it("throws unknown-key for undeclared keys", () => {
    expect(() => i18n.t("nope.missing")).toThrowError(
      expect.objectContaining({ code: "unknown-key" }),
    );
    expect(() => i18n.t("action.cancel.short")).toThrowError(
      expect.objectContaining({ code: "unknown-key" }),
    );
  });

  it("tSafe falls back to the localized generic error instead of throwing", () => {
    const safe = i18n.tSafe("nope.missing");
    expect(safe).toBe(i18n.t("error.INTERNAL"));
    expect(safe).not.toContain("nope.missing");
  });

  it("variant: 'short'/'long' resolve to .short/.long keys when declared", () => {
    const custom = createI18n({
      catalogs: {
        en: { "k.v": "base", "k.v.short": "tiny" },
        ar: { "k.v": "أساسي", "k.v.short": "صغير" },
      },
      locale: "en",
    });
    expect(custom.hasVariant("k.v", "short")).toBe(true);
    expect(custom.t("k.v", undefined, { variant: "short" })).toBe("tiny");
    expect(custom.t("k.v", undefined, { variant: "long" })).toBe("base");
    expect(custom.hasVariant("k.v", "long")).toBe(false);
    // default catalog has no .short/.long keys yet — fallback to base
    expect(i18n.hasVariant("hero.title", "short")).toBe(false);
    expect(i18n.t("hero.title", undefined, { variant: "short" })).toBe(i18n.t("hero.title"));
  });
});
