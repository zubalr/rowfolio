/**
 * Locale-catalog parity helpers. Structural checks come from the
 * independent tooling/test/locale module; the contract's key manifest
 * (TRANSLATION_KEY_MANIFEST) is the authority on which keys must exist.
 */
import { TRANSLATION_KEY_MANIFEST, translationKeys } from '../../packages/contracts/src/index.ts';
import { catalogGaps, manifestGaps, placeholders, type Catalog, type CatalogGaps } from '../../tooling/test/locale.ts';
import { loadJson } from './repo.ts';

export { catalogGaps, manifestGaps, placeholders, TRANSLATION_KEY_MANIFEST, translationKeys };
export type { Catalog, CatalogGaps };

export function loadCatalog(absPath: string): Catalog {
  const raw = loadJson<Record<string, unknown>>(absPath);
  const out: Catalog = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function describeGaps(label: string, gaps: CatalogGaps): string {
  const parts: string[] = [];
  if (gaps.missingKeys.length) parts.push(`missing: ${gaps.missingKeys.join(', ')}`);
  if (gaps.extraKeys.length) parts.push(`extra: ${gaps.extraKeys.join(', ')}`);
  for (const m of gaps.placeholderMismatches) {
    parts.push(`placeholders ${m.key}: {${m.expected.join(',')}} != {${m.actual.join(',')}}`);
  }
  if (gaps.emptyValues.length) parts.push(`empty values: ${gaps.emptyValues.join(', ')}`);
  return `${label}: catalog parity failure — ${parts.join('; ') || 'unknown'}`;
}

/** Assert a candidate catalog has every reference key, no extras, matching placeholders, no empty values. */
export function assertCatalogParity(reference: Catalog, candidate: Catalog, label = 'catalog'): void {
  const gaps = catalogGaps(reference, candidate);
  if (gaps.missingKeys.length || gaps.extraKeys.length || gaps.placeholderMismatches.length || gaps.emptyValues.length) {
    throw new Error(describeGaps(label, gaps));
  }
}

/** Assert a catalog satisfies the contract key manifest (key set + declared placeholders). */
export function assertManifestCoverage(candidate: Catalog, label = 'catalog'): void {
  const gaps = manifestGaps({ keys: TRANSLATION_KEY_MANIFEST.keys as Record<string, string[]> }, candidate);
  if (gaps.missingKeys.length || gaps.extraKeys.length || gaps.placeholderMismatches.length) {
    throw new Error(describeGaps(`${label} vs contract manifest`, gaps));
  }
}
