// Catalog content coverage: string-level checks over the real English/Arabic
// catalogs — unit and state wording, placeholder hygiene, mixed-script
// inventory and label-length drift. These run without any UI; nothing here
// claims screenshots, rendering or native Arabic shaping review.
//
// Expectations are pinned by tooling/test/corpus/i18n/generate-content-fixture.ts
// against a fixed inspected integration snapshot; when catalogs land on a
// checkout the tests compare live bytes against the pins. Wording quality
// concerns become private proposals to the catalog owners — a wording
// preference never fails a test, only drift and hygiene do.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { resolveCatalogDir } from '../../../../tooling/test/corpus/i18n/check-catalog.ts';
import {
  CATALOG_SHA256,
  KEY_COUNTS,
  LONGEST_LABELS,
  MIXED_SCRIPT_KEYS,
  PLACEHOLDER_COUNTS,
  STATE_COPY,
  STATE_KEYS,
  UNITS_COPY,
  UNITS_KEYS,
} from './content-fixture.gen.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

const catalogDir = resolveCatalogDir(REPO_ROOT);
const pendingReason =
  'locale catalogs (en.json/ar.json) are not on this checkout; catalog content checks are pending final integration';

function loadCatalog(locale: 'en' | 'ar'): Record<string, string> {
  const file = `${catalogDir}/${locale}.json`;
  return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, string>;
}

function catalogBytes(locale: 'en' | 'ar'): Buffer {
  return readFileSync(`${catalogDir}/${locale}.json`);
}

function placeholderTokens(value: string): string[] {
  return [...String(value).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1] ?? '');
}

const ARABIC_RE = /[\u0600-\u06FF]/;
const LATIN_RE = /[A-Za-z]/;

describe('catalog content coverage (string level)', () => {
  test.skipIf(catalogDir === null)('live catalogs match the pinned snapshot bytes', () => {
    const en = createHash('sha256').update(catalogBytes('en')).digest('hex');
    const ar = createHash('sha256').update(catalogBytes('ar')).digest('hex');
    expect(
      { en, ar },
      'catalogs drifted from the pinned snapshot: rerun node tooling/test/corpus/i18n/generate-content-fixture.ts against the new snapshot',
    ).toEqual(CATALOG_SHA256);
  });

  test.skipIf(catalogDir === null)('unit wording is present and hygienic', () => {
    const en = loadCatalog('en');
    const ar = loadCatalog('ar');
    for (const key of UNITS_KEYS) {
      const enValue = UNITS_COPY[`en:${key}`];
      const arValue = UNITS_COPY[`ar:${key}`];
      expect(enValue, `units key ${key} missing from pinned en copy`).toBeTruthy();
      expect(arValue, `units key ${key} missing from pinned ar copy`).toBeTruthy();
      expect(en[key]).toBe(enValue);
      expect(ar[key]).toBe(arValue);
      // percentage points are named, not implied by a bare symbol
      expect(enValue ?? '').toMatch(/percentage points/);
      expect(arValue ?? '').toMatch(/نقاط|نقطة/);
    }
  });

  test.skipIf(catalogDir === null)('state copy exists for empty/unknown/unavailable surfaces', () => {
    const en = loadCatalog('en');
    const ar = loadCatalog('ar');
    for (const key of STATE_KEYS) {
      expect((en[key] ?? '').length, `en state copy ${key} should not be empty`).toBeGreaterThan(0);
      expect((ar[key] ?? '').length, `ar state copy ${key} should not be empty`).toBeGreaterThan(0);
      expect(en[key]).toBe(STATE_COPY[`en:${key}`]);
      expect(ar[key]).toBe(STATE_COPY[`ar:${key}`]);
    }
  });

  test.skipIf(catalogDir === null)('all catalog values pass placeholder and whitespace hygiene', () => {
    for (const locale of ['en', 'ar'] as const) {
      const catalog = loadCatalog(locale);
      for (const [key, value] of Object.entries(catalog)) {
        expect(value, `${key} in ${locale} has leading/trailing whitespace`).toBe(value.trim());
        expect(value, `${key} in ${locale} contains doubled spaces`).not.toMatch(/ {2}/);
        const tokens = placeholderTokens(value);
        for (const token of tokens) {
          expect(token.length, `${key} has an empty placeholder {} in ${locale}`).toBeGreaterThan(0);
        }
        expect(
          (value.match(/\{/g) ?? []).length,
          `${key} in ${locale} has an unbalanced opening brace`,
        ).toBe((value.match(/\}/g) ?? []).length);
      }
    }
  });

  test.skipIf(catalogDir === null)('label lengths and mixed-script inventory match the pinned snapshot', () => {
    const en = loadCatalog('en');
    const ar = loadCatalog('ar');
    for (const locale of ['en', 'ar'] as const) {
      const catalog = locale === 'en' ? en : ar;
      const pinned = LONGEST_LABELS[locale];
      for (const entry of pinned ?? []) {
        expect(
          [...(catalog[entry.key] ?? '')].length,
          `label length for ${entry.key} changed vs the pinned snapshot`,
        ).toBe(entry.length);
      }
      const mixed = Object.keys(catalog).filter(
        (key) => ARABIC_RE.test(catalog[key] ?? '') && LATIN_RE.test(catalog[key] ?? ''),
      ).sort();
      expect(mixed, `mixed-script inventory for ${locale} drifted from the pinned snapshot`).toEqual(
        MIXED_SCRIPT_KEYS[locale],
      );
    }
    expect(Object.keys(en).length).toBe(KEY_COUNTS.en);
    expect(Object.keys(ar).length).toBe(KEY_COUNTS.ar);
  });

  test.skipIf(catalogDir === null)('placeholder usage inventory matches the pinned snapshot', () => {
    const en = loadCatalog('en');
    const ar = loadCatalog('ar');
    for (const [locale, catalog] of [
      ['en', en],
      ['ar', ar],
    ] as const) {
      const counts: Record<string, number> = {};
      for (const value of Object.values(catalog)) {
        for (const token of placeholderTokens(value)) {
          counts[token] = (counts[token] ?? 0) + 1;
        }
      }
      expect(counts, `placeholder usage for ${locale} drifted from the pinned snapshot`).toEqual(
        PLACEHOLDER_COUNTS[locale],
      );
    }
  });
});

test('catalog content pending state is explicit, never silent', (ctx) => {
  if (catalogDir === null) {
    console.warn(`[i18n] PENDING: ${pendingReason}`);
    ctx.skip(true, pendingReason);
  } else {
    expect(KEY_COUNTS.en).toBeGreaterThan(0);
    expect(KEY_COUNTS.ar).toBeGreaterThan(0);
  }
});
