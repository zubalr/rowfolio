import type { Catalog, MessageKey, PluralCategory } from "./catalog.ts";
import { isPluralCategory } from "./catalog.ts";
import { I18nError } from "./errors.ts";

/**
 * CLDR plural category for `count` in the given Intl locale tag. `Intl.PluralRules`
 * already implements the required operand semantics (selection on |n| for Arabic),
 * so a signed count picks the category of its absolute value while display keeps
 * the sign.
 */
export function selectPluralCategory(localeTag: string, count: number): PluralCategory {
  if (!Number.isFinite(count)) {
    throw new I18nError("invalid-count", `Plural count must be finite, got ${String(count)}`, {
      count: String(count),
    });
  }
  const category = new Intl.PluralRules(localeTag).select(count);
  return isPluralCategory(category) ? category : "other";
}

/** `${base}.${category}` — the counted-noun key convention from the contract. */
export function pluralVariantKey(baseKey: string, category: PluralCategory): MessageKey {
  return `${baseKey}.${category}`;
}

/**
 * Resolves the template for a counted noun: `base.category` first, then the
 * mandatory `base.other` fallback. A missing `.other` form is an `unknown-key`
 * failure — counted nouns must declare it.
 */
export function resolvePluralKey(
  catalog: Catalog,
  baseKey: string,
  category: PluralCategory,
): { key: MessageKey; template: string } {
  const candidate = pluralVariantKey(baseKey, category);
  const exact = catalog[candidate];
  if (exact !== undefined) {
    return { key: candidate, template: exact };
  }
  const otherKey = pluralVariantKey(baseKey, "other");
  const other = catalog[otherKey];
  if (other !== undefined) {
    return { key: otherKey, template: other };
  }
  throw new I18nError("unknown-key", `No plural form '${category}' or 'other' for key '${baseKey}'`, {
    key: baseKey,
    category,
  });
}
