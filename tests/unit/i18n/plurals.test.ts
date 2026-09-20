import { describe, expect, it } from "vitest";
import { createI18n, pluralVariantKey, resolvePluralKey, selectPluralCategory } from "../../../packages/i18n/src/index.ts";

describe("selectPluralCategory (CLDR via Intl.PluralRules)", () => {
  it("English: one/other", () => {
    expect(selectPluralCategory("en-US", 1)).toBe("one");
    expect(selectPluralCategory("en-US", 0)).toBe("other");
    expect(selectPluralCategory("en-US", 2)).toBe("other");
  });

  it("Arabic uses all six categories at canonical counts", () => {
    expect(selectPluralCategory("ar-QA", 0)).toBe("zero");
    expect(selectPluralCategory("ar-QA", 1)).toBe("one");
    expect(selectPluralCategory("ar-QA", 2)).toBe("two");
    expect(selectPluralCategory("ar-QA", 3)).toBe("few");
    expect(selectPluralCategory("ar-QA", 11)).toBe("many");
    expect(selectPluralCategory("ar-QA", 100)).toBe("other");
    // few = 3..10, many = 11..99
    expect(selectPluralCategory("ar-QA", 10)).toBe("few");
    expect(selectPluralCategory("ar-QA", 99)).toBe("many");
  });

  it("rejects non-finite counts", () => {
    expect(() => selectPluralCategory("ar-QA", Number.NaN)).toThrowError(
      expect.objectContaining({ code: "invalid-count" }),
    );
  });
});

describe("resolvePluralKey", () => {
  it("falls back to .other when a category key is absent", () => {
    const catalog = { "count.x.other": "{count} things" };
    expect(resolvePluralKey(catalog, "count.x", "one").key).toBe("count.x.other");
  });

  it("throws unknown-key when no form exists", () => {
    expect(() => resolvePluralKey({}, "count.x", "other")).toThrowError(
      expect.objectContaining({ code: "unknown-key" }),
    );
  });

  it("builds variant keys", () => {
    expect(pluralVariantKey("count.records", "few")).toBe("count.records.few");
  });
});

describe("i18n.plural — Arabic counted nouns in every category", () => {
  const i18n = createI18n({ locale: "ar" });
  const digit = (v: string) => i18n.formatInteger(v);

  it.each([
    ["0", "zero"],
    ["1", "one"],
    ["2", "two"],
    ["3", "few"],
    ["11", "many"],
    ["100", "other"],
  ] as const)("count.records %s → %s", (count, category) => {
    const expected = i18n.t(`count.records.${category}`, { count: digit(count) });
    expect(i18n.plural("count.records", count)).toBe(expected);
  });

  it("Arabic zero uses the 'no records' idiom", () => {
    expect(i18n.plural("count.records", "0")).toBe("لا توجد سجلات (٠)");
  });

  it("Arabic dual renders the catalog's dual form", () => {
    expect(i18n.plural("count.records", "2")).toBe("سجلان (٢)");
  });

  it("English plural switches between one/other", () => {
    const en = createI18n({ locale: "en" });
    expect(en.plural("count.records", "1")).toBe("1 record");
    expect(en.plural("count.records", "5")).toBe("5 records");
  });
});
