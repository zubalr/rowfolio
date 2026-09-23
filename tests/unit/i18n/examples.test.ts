import { describe, expect, it } from "vitest";
import { ARABIC_REVIEW, I18N_CONTRACT_VERSION, buildLocaleExamples, reviewFlagsFor, defaultCatalogs } from "../../../packages/i18n/src/index.ts";

describe("versioned examples", () => {
  const examples = buildLocaleExamples();

  it("carries the contract version", () => {
    expect(I18N_CONTRACT_VERSION).toBe("1.0.0");
    expect(examples.en.contractVersion).toBe("1.0.0");
    expect(examples.ar.contractVersion).toBe("1.0.0");
  });

  it("provides an example set for each locale", () => {
    expect(Object.keys(examples).sort()).toEqual(["ar", "en"]);
    for (const set of Object.values(examples)) {
      expect(Object.keys(set.copy).length).toBeGreaterThan(0);
      expect(set.plurals.byCount["0"]).toBeTruthy();
      expect(set.plurals.byCount["100"]).toBeTruthy();
      expect(set.numbers.signedPercent).toBeTruthy();
      expect(set.dates.day).toBeTruthy();
      expect(set.parsing.output).toBe("1234.5");
      expect(set.isolation.identifier).toContain("f0d6d06e934b1eef");
    }
  });

  it("examples are frozen snapshots", () => {
    expect(Object.isFrozen(examples.en)).toBe(true);
    expect(Object.isFrozen(examples.ar.plurals)).toBe(true);
  });

  it("big-decimal example keeps full precision", () => {
    expect(examples.en.numbers.exactBigDecimal).toBe("12,345,678,901,234,567,890.25");
  });
});

describe("Arabic terminology review status", () => {
  it("is explicitly pending native review — never claimed complete", () => {
    expect(ARABIC_REVIEW.status).toBe("pending-native-review");
    expect(ARABIC_REVIEW.reviewer).toBeNull();
    expect(ARABIC_REVIEW.flags.length).toBeGreaterThan(0);
  });

  it("flags reference real catalog keys and quote current copy", () => {
    const catalog = defaultCatalogs().ar;
    for (const flag of reviewFlagsFor(catalog)) {
      expect(flag.key in catalog, `flag on unknown key ${flag.key}`).toBe(true);
      expect(flag.arabicText).toBe(catalog[flag.key]);
      expect(flag.concern.length).toBeGreaterThan(0);
    }
  });

  it("reviewFlagsFor reflects catalog edits", () => {
    const catalog = { ...defaultCatalogs().ar };
    delete catalog["metric.margin"];
    const keys = reviewFlagsFor(catalog).map((f) => f.key);
    expect(keys).not.toContain("metric.margin");
    expect(keys.length).toBe(ARABIC_REVIEW.flags.length - 1);
  });
});
