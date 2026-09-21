import { describe, expect, it } from "vitest";
import { LANDING_COPY_KEYS, landingCopy } from "./copy.ts";

describe("landing copy", () => {
  it("declares every key in both locales with non-empty strings", () => {
    for (const key of LANDING_COPY_KEYS) {
      for (const locale of ["en", "ar"] as const) {
        const text = landingCopy(locale, key);
        expect(text, `${locale} ${key}`).toBeTruthy();
        expect(text, `${locale} ${key} leaked a key`).not.toBe(key);
      }
    }
  });

  it("renders {params} placeholders", () => {
    expect(landingCopy("en", "pres.progress", { n: 2, total: 4 })).toBe("Step 2 of 4");
    expect(
      landingCopy("en", "walk.check.dupNote", { n: 17 }),
    ).toContain("17");
  });

  it("Arabic copy is distinct from English where the string is translated", () => {
    // Shared-format strings (placeholders) are identical by design; the rest
    // must be a real translation, not a copied English string.
    const shared = new Set<string>(["common.scopeValue"]);
    for (const key of LANDING_COPY_KEYS) {
      if (shared.has(key)) continue;
      expect(
        landingCopy("ar", key) !== landingCopy("en", key),
        `ar ${key} is identical to en`,
      ).toBe(true);
    }
  });
});
