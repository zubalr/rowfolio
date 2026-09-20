/**
 * Locale catalog parity checks (tooling/test), independent of packages/i18n.
 *
 * contract: flat dot-separated keys, identical key and placeholder sets
 * across locales, placeholders are `{name}` tokens, counted-noun variants
 * use `.zero/.one/.two/.few/.many/.other` suffixes.
 */
import { finding, type Finding } from './findings.ts';

export type Catalog = Record<string, string>;

const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;

export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]!))].sort();
}

export interface CatalogGaps {
  missingKeys: string[];
  extraKeys: string[];
  placeholderMismatches: { key: string; expected: string[]; actual: string[] }[];
  emptyValues: string[];
}

export function catalogGaps(reference: Catalog, candidate: Catalog): CatalogGaps {
  const refKeys = Object.keys(reference).sort();
  const candKeys = new Set(Object.keys(candidate));
  const refSet = new Set(refKeys);
  const missingKeys = refKeys.filter((k) => !candKeys.has(k));
  const extraKeys = [...candKeys].filter((k) => !refSet.has(k)).sort();
  const placeholderMismatches: CatalogGaps['placeholderMismatches'] = [];
  const emptyValues: string[] = [];
  for (const k of refKeys) {
    if (!candKeys.has(k)) continue;
    const expected = placeholders(reference[k]!);
    const actual = placeholders(candidate[k]!);
    if (expected.join(',') !== actual.join(',')) {
      placeholderMismatches.push({ key: k, expected, actual });
    }
    if (candidate[k]!.trim().length === 0) emptyValues.push(k);
  }
  return { missingKeys, extraKeys, placeholderMismatches, emptyValues };
}

/** Convert gaps into error findings (missing key = test failure, per spec). */
export function gapFindings(gaps: CatalogGaps, path?: string): Finding[] {
  const out: Finding[] = [];
  for (const k of gaps.missingKeys) {
    out.push(finding('locale.missing-key', 'error', `key ${JSON.stringify(k)} absent from candidate catalog`, path));
  }
  for (const k of gaps.extraKeys) {
    out.push(finding('locale.extra-key', 'error', `key ${JSON.stringify(k)} not in reference`, path));
  }
  for (const m of gaps.placeholderMismatches) {
    out.push(
      finding(
        'locale.placeholder-mismatch',
        'error',
        `key ${JSON.stringify(m.key)} placeholders {${m.expected.join(',')}} != {${m.actual.join(',')}}`,
        path,
      ),
    );
  }
  for (const k of gaps.emptyValues) {
    out.push(finding('locale.empty-value', 'error', `key ${JSON.stringify(k)} has empty translation`, path));
  }
  return out;
}

/**
 * Check a candidate catalog against the contract key manifest
 * ({ schemaVersion, keys: { key: [placeholders] } }).
 */
export function manifestGaps(manifest: { keys: Record<string, string[]> }, candidate: Catalog): CatalogGaps {
  const manifestKeys = Object.keys(manifest.keys).sort();
  const candKeys = new Set(Object.keys(candidate));
  const manifestSet = new Set(manifestKeys);
  const missingKeys = manifestKeys.filter((k) => !candKeys.has(k));
  const extraKeys = [...candKeys].filter((k) => !manifestSet.has(k)).sort();
  const placeholderMismatches: CatalogGaps['placeholderMismatches'] = [];
  const emptyValues: string[] = [];
  for (const k of manifestKeys) {
    if (!candKeys.has(k)) continue;
    const expected = [...manifest.keys[k]!].sort();
    const actual = placeholders(candidate[k]!);
    if (expected.join(',') !== actual.join(',')) {
      placeholderMismatches.push({ key: k, expected, actual });
    }
    if (candidate[k]!.trim().length === 0) emptyValues.push(k);
  }
  return { missingKeys, extraKeys, placeholderMismatches, emptyValues };
}
