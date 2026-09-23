import type { Locale } from "@rowfolio/contracts";
import { I18nError } from "./errors.ts";
import arCatalogJson from "./locales/ar.json";
import enCatalogJson from "./locales/en.json";

/**
 * The shipped copy catalogs are byte-identical to `contracts/locales/{en,ar}.json`
 * (contract v1.0.0). Keys are flat, dot-separated, and hold `{name}` placeholders.
 * `tests/unit/i18n` pins the SHA-256 of both files to the contract copies.
 */
export type MessageKey = string;
export type Catalog = Readonly<Record<string, string>>;
export type Catalogs = Readonly<Record<Locale, Catalog>>;

export const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "ar"] as const satisfies readonly Locale[];

const KEY_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;
const PLACEHOLDER_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ar";
}

export function assertLocale(value: unknown): Locale {
  if (!isLocale(value)) {
    throw new I18nError("invalid-locale", `Unsupported locale: ${String(value)}`, {
      value: String(value),
    });
  }
  return value;
}

/** Placeholder names declared by a template, in first-appearance order. */
export function extractPlaceholders(template: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** True when `category` is one of the six CLDR plural categories. */
export function isPluralCategory(value: string): value is PluralCategory {
  return (PLURAL_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Validates one catalog: flat dot keys, non-empty string values, and braces that
 * only appear inside well-formed `{name}` placeholders. Throws `I18nError` with
 * code `invalid-catalog` on the first violation.
 */
export function validateCatalog(catalog: Readonly<Record<string, unknown>>, label: string): asserts catalog is Catalog {
  for (const [key, value] of Object.entries(catalog)) {
    if (!KEY_PATTERN.test(key)) {
      throw new I18nError("invalid-catalog", `Catalog ${label} has a malformed key '${key}'`, {
        catalog: label,
        key,
      });
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new I18nError("invalid-catalog", `Catalog ${label} key '${key}' must map to a non-empty string`, {
        catalog: label,
        key,
      });
    }
    const stripped = value.replace(PLACEHOLDER_PATTERN, "");
    if (stripped.includes("{") || stripped.includes("}")) {
      throw new I18nError("invalid-catalog", `Catalog ${label} key '${key}' contains a malformed placeholder`, {
        catalog: label,
        key,
        template: value,
      });
    }
  }
}

/**
 * Contract rule: the EN and AR catalogs are identical key sets with identical
 * placeholder sets per key (order may differ between locales — comparison is by
 * set). Any drift is a hard failure (`catalog-mismatch`), never a silent
 * fallback.
 */
export function validateCatalogParity(catalogs: Catalogs): void {
  const en = catalogs.en;
  const ar = catalogs.ar;
  const enKeys = new Set(Object.keys(en));
  const arKeys = new Set(Object.keys(ar));
  const missingInAr = [...enKeys].filter((key) => !arKeys.has(key));
  const missingInEn = [...arKeys].filter((key) => !enKeys.has(key));
  if (missingInAr.length > 0 || missingInEn.length > 0) {
    throw new I18nError("catalog-mismatch", "EN/AR catalogs have different key sets", {
      missingInAr,
      missingInEn,
    });
  }
  for (const key of enKeys) {
    const enParams = extractPlaceholders(en[key] ?? "").sort();
    const arParams = extractPlaceholders(ar[key] ?? "").sort();
    if (enParams.join(" ") !== arParams.join(" ")) {
      throw new I18nError("catalog-mismatch", `Key '${key}' has different placeholders per locale`, {
        key,
        en: enParams,
        ar: arParams,
      });
    }
  }
}

/** Validates and freezes a catalog set for use by a provider. */
export function prepareCatalogs(catalogs: Catalogs): Catalogs {
  validateCatalog(catalogs.en, "en");
  validateCatalog(catalogs.ar, "ar");
  validateCatalogParity(catalogs);
  return catalogs;
}

const builtinCatalogs: Catalogs = Object.freeze({
  en: Object.freeze({ ...enCatalogJson }) as Catalog,
  ar: Object.freeze({ ...arCatalogJson }) as Catalog,
});

let builtinValidated = false;

/** The shipped v1.0.0 catalogs (frozen). Validated on first access. */
export function defaultCatalogs(): Catalogs {
  if (!builtinValidated) {
    prepareCatalogs(builtinCatalogs);
    builtinValidated = true;
  }
  return builtinCatalogs;
}

export { arCatalogJson, enCatalogJson };
