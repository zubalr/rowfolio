/**
 * Locale-catalog self-tests: a missing key, renamed placeholder or extra
 * key must fail parity; the contract key manifest is authoritative for
 * coverage checks.
 */
import { describe, expect, it } from 'vitest';
import { TRANSLATION_KEY_MANIFEST, translationKeys } from '../../packages/contracts/src/index.ts';
import {
  assertCatalogParity,
  assertManifestCoverage,
  catalogGaps,
  hostileFixture,
  loadCatalog,
  manifestGaps,
  placeholders,
} from './index.ts';

const load = (name: string) => loadCatalog(hostileFixture(`locale/${name}`));
const reference = load('reference.catalog.json');

describe('placeholder extraction', () => {
  it('finds sorted unique placeholder names', () => {
    expect(placeholders('أهلاً {name} — {count} عنصر باسم {name}')).toEqual(['count', 'name']);
    expect(placeholders('plain')).toEqual([]);
  });
});

describe('catalog parity', () => {
  it('equivalent catalog passes', () => {
    expect(() => assertCatalogParity(reference, load('ar-ok.catalog.json'), 'ar-ok')).not.toThrow();
  });

  it('missing locale key fails parity', () => {
    const gaps = catalogGaps(reference, load('ar-missing-key.catalog.json'));
    expect(gaps.missingKeys).toContain('greet.user');
    expect(() => assertCatalogParity(reference, load('ar-missing-key.catalog.json'), 'ar-missing')).toThrow(/missing: greet\.user/);
  });

  it('renamed placeholder fails parity', () => {
    const gaps = catalogGaps(reference, load('ar-placeholder-mismatch.catalog.json'));
    expect(gaps.placeholderMismatches.map((m) => m.key)).toEqual(['greet.user']);
    expect(() => assertCatalogParity(reference, load('ar-placeholder-mismatch.catalog.json'), 'ar-ph')).toThrow(/placeholders greet\.user/);
  });

  it('extra key fails parity', () => {
    const gaps = catalogGaps(reference, load('ar-extra-key.catalog.json'));
    expect(gaps.extraKeys).toContain('ghost.key');
    expect(() => assertCatalogParity(reference, load('ar-extra-key.catalog.json'), 'ar-extra')).toThrow(/extra: ghost\.key/);
  });

  it('empty value fails parity', () => {
    const candidate = { ...reference, 'brand.name': '   ' };
    expect(() => assertCatalogParity(reference, candidate, 'empty')).toThrow(/empty values: brand\.name/);
  });
});

describe('contract manifest coverage', () => {
  it('manifest declares keys with placeholder metadata', () => {
    expect(Object.keys(TRANSLATION_KEY_MANIFEST.keys).length).toBeGreaterThan(0);
    expect(translationKeys()).toEqual(Object.keys(TRANSLATION_KEY_MANIFEST.keys));
    for (const [k, ph] of Object.entries(TRANSLATION_KEY_MANIFEST.keys)) {
      expect(Array.isArray(ph), k).toBe(true);
    }
  });

  it('catalog missing a manifest key fails coverage', () => {
    const manifestKey = Object.keys(TRANSLATION_KEY_MANIFEST.keys)[0]!;
    const catalog = { [manifestKey]: 'x' };
    const gaps = manifestGaps({ keys: TRANSLATION_KEY_MANIFEST.keys as Record<string, string[]> }, catalog);
    expect(gaps.missingKeys.length).toBeGreaterThan(0);
    expect(() => assertManifestCoverage(catalog, 'sparse')).toThrow(/manifest/);
  });

  it('catalog with wrong placeholders fails coverage', () => {
    // build a catalog with every manifest key but break one placeholder
    const catalog: Record<string, string> = {};
    for (const [k, ph] of Object.entries(TRANSLATION_KEY_MANIFEST.keys)) {
      catalog[k] = ph.length > 0 ? `x {${ph.join('} {')}}` : 'x';
    }
    const key = Object.keys(TRANSLATION_KEY_MANIFEST.keys).find((k) => TRANSLATION_KEY_MANIFEST.keys[k]!.length > 0);
    if (key) {
      catalog[key] = 'x {wrongName}';
      const gaps = manifestGaps({ keys: TRANSLATION_KEY_MANIFEST.keys as Record<string, string[]> }, catalog);
      expect(gaps.placeholderMismatches.map((m) => m.key)).toContain(key);
    }
  });
});
