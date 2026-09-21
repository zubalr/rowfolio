import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TRANSLATION_KEY_MANIFEST } from "../../../packages/contracts/src/index.ts";
import {
  PLURAL_CATEGORIES,
  defaultCatalogs,
  extractPlaceholders,
  prepareCatalogs,
  validateCatalogParity,
  I18nError,
} from "../../../packages/i18n/src/index.ts";
import { arCatalogJson, enCatalogJson } from "../../../packages/i18n/src/catalog.ts";

const enCat: Record<string, string> = enCatalogJson;
const arCat: Record<string, string> = arCatalogJson;

const LOCALES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "packages/i18n/src/locales",
);

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("catalog contract identity", () => {
  it("ships catalogs byte-identical to contracts/locales v1.0.0", () => {
    // Hashes of the authoritative contract copies in the implementation
    // package; changing a catalog means a coordinated contract change.
    expect(sha256(join(LOCALES_DIR, "en.json"))).toBe(
      "bc4b2d494f72d6ea29538f114fc0e11aac17666aae4b3a516c920033e77c5dea",
    );
    expect(sha256(join(LOCALES_DIR, "ar.json"))).toBe(
      "74f8f9a9b7955d0f19be03d15e71c3978d6c14c814a4c61a6b6051bd86bbcf56",
    );
  });

  it("has no duplicate keys in the raw JSON files", () => {
    for (const file of ["en.json", "ar.json"]) {
      const raw = readFileSync(join(LOCALES_DIR, file), "utf8");
      const keys = [...raw.matchAll(/^\s{2}"([^"]+)":/gm)].map((m) => m[1]);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("contains 203 keys per locale", () => {
    expect(Object.keys(enCatalogJson)).toHaveLength(203);
    expect(Object.keys(arCatalogJson)).toHaveLength(203);
  });
});

describe("catalog parity", () => {
  it("en and ar key sets are identical", () => {
    expect(Object.keys(enCatalogJson).sort()).toEqual(Object.keys(arCatalogJson).sort());
    expect(() => validateCatalogParity(defaultCatalogs())).not.toThrow();
  });

  it("en and ar placeholder sets are identical per key", () => {
    for (const key of Object.keys(enCatalogJson)) {
      const enParams = extractPlaceholders(enCat[key]!).sort();
      const arParams = extractPlaceholders(arCat[key]!).sort();
      expect(arParams, `placeholder drift on '${key}'`).toEqual(enParams);
    }
  });

  it("every shipped key is declared in the contract translation-key manifest", () => {
    const manifest = new Set(Object.keys(TRANSLATION_KEY_MANIFEST.keys));
    for (const key of Object.keys(enCatalogJson)) {
      expect(manifest.has(key), `key '${key}' missing from translation-keys.json`).toBe(true);
    }
    for (const key of manifest) {
      expect(key in enCatalogJson, `manifest key '${key}' missing from en catalog`).toBe(true);
    }
  });

  it("every manifest placeholder matches the template's placeholders", () => {
    for (const [key, declared] of Object.entries(TRANSLATION_KEY_MANIFEST.keys)) {
      const actual = extractPlaceholders(enCat[key]!).sort();
      expect(actual, `manifest/catalog placeholder drift on '${key}'`).toEqual([...declared].sort());
    }
  });

  it("catalogs are frozen", () => {
    const catalogs = defaultCatalogs();
    expect(Object.isFrozen(catalogs.en)).toBe(true);
    expect(Object.isFrozen(catalogs.ar)).toBe(true);
  });

  it("rejects catalogs whose key sets drift", () => {
    const broken = {
      en: { "a.b": "x" },
      ar: { "a.b": "x", "a.c": "y" },
    };
    expect(() => prepareCatalogs(broken)).toThrowError(I18nError);
    expect(() => prepareCatalogs(broken)).toThrowError(
      expect.objectContaining({ code: "catalog-mismatch" }),
    );
  });

  it("rejects catalogs with placeholder drift between locales", () => {
    const broken = {
      en: { "a.b": "value {x}" },
      ar: { "a.b": "قيمة {y}" },
    };
    expect(() => prepareCatalogs(broken)).toThrowError(
      expect.objectContaining({ code: "catalog-mismatch" }),
    );
  });
});

describe("required coverage", () => {
  const requiredNamespaces = [
    "brand.",
    "hero.",
    "action.",
    "error.",
    "finding.",
    "metric.",
    "quality.",
    "scenario.",
    "evidence.",
    "export.",
    "upload.",
    "workspace.",
    "chart.",
    "period.",
    "region.",
    "sheet.",
    "a11y.",
    "empty.",
    "privacy.",
    "language.",
    "limitations.",
    "coverage.",
    "count.",
  ];

  it("covers every required namespace in both locales", () => {
    for (const prefix of requiredNamespaces) {
      expect(
        Object.keys(enCatalogJson).some((k) => k.startsWith(prefix)),
        `missing namespace ${prefix}`,
      ).toBe(true);
    }
  });

  it("has all nine worker error codes as localized strings", () => {
    const codes = [
      "INVALID_FILE",
      "LIMIT_EXCEEDED",
      "AMBIGUOUS_INPUT",
      "UNSUPPORTED",
      "CANCELLED",
      "TIMEOUT",
      "EXPORT_FAILED",
      "SCHEMA_MISMATCH",
      "INTERNAL",
    ];
    for (const code of codes) {
      expect(enCat[`error.${code}`], `error.${code}`).toBeTruthy();
      expect(arCat[`error.${code}`], `error.${code}`).toBeTruthy();
    }
  });

  it("declares all six CLDR plural categories for counted records", () => {
    for (const category of PLURAL_CATEGORIES) {
      const key = `count.records.${category}`;
      expect(enCat[key], key).toBeTruthy();
      expect(arCat[key], key).toBeTruthy();
    }
  });
});
