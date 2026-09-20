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
      "21645d6f7b46cf4a4716d5de44585e8c16ac44d24f73d6037f3237d6a6f76b3e",
    );
    expect(sha256(join(LOCALES_DIR, "ar.json"))).toBe(
      "32145f753160b8e9a0ce6b42791cfb70ba498885efade6fa4257170b2dcbcab2",
    );
  });

  it("has no duplicate keys in the raw JSON files", () => {
    for (const file of ["en.json", "ar.json"]) {
      const raw = readFileSync(join(LOCALES_DIR, file), "utf8");
      const keys = [...raw.matchAll(/^\s{2}"([^"]+)":/gm)].map((m) => m[1]);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("contains 201 keys per locale", () => {
    expect(Object.keys(enCatalogJson)).toHaveLength(201);
    expect(Object.keys(arCatalogJson)).toHaveLength(201);
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
