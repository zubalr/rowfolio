// Mechanical EN/AR catalog checks.
//
// Catalog location resolution: $ROWFOLIO_I18N_CATALOG_DIR, then
// packages/i18n/catalogs, packages/i18n/src/catalogs, then
// packages/contracts/source/locales. On checkouts where the locale catalogs
// have not landed yet (the catalog owner owns that delivery), every parity
// test below reports as explicitly PENDING with that reason — it neither
// passes vacuously nor silently disappears.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  mutateDropKey,
  mutateDropPluralForm,
  mutateRenamePlaceholder,
  PLURAL_SUFFIXES,
  resolveCatalogDir,
  validateCatalogs,
  type Catalog,
  type TranslationManifest,
} from '../../../../tooling/test/corpus/i18n/check-catalog.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MANIFEST_PATH = `${REPO_ROOT}packages/contracts/source/translation-keys.json`;

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as TranslationManifest;
const catalogDir = resolveCatalogDir(REPO_ROOT);
const pendingReason =
  'locale catalogs (en.json/ar.json) have not landed on this checkout; catalog parity checks are pending final integration';

function loadCatalogOrThrow(locale: 'en' | 'ar'): Catalog {
  const file = `${catalogDir}/${locale}.json`;
  if (!existsSync(file)) throw new Error(`catalog directory ${catalogDir} is missing ${locale}.json`);
  return JSON.parse(readFileSync(file, 'utf-8')) as Catalog;
}

describe('en/ar catalog parity', () => {
  test.skipIf(catalogDir === null)('catalogs exist and pass full mechanical validation', () => {
    const en = loadCatalogOrThrow('en');
    const ar = loadCatalogOrThrow('ar');
    const issues = validateCatalogs(manifest, { en, ar });
    expect(issues, `catalog issues: ${JSON.stringify(issues.slice(0, 20), null, 2)}`).toEqual([]);
  });

  test.skipIf(catalogDir === null)('a missing key is detected', () => {
    const en = mutateDropKey(loadCatalogOrThrow('en'), 'common.period');
    const ar = loadCatalogOrThrow('ar');
    const issues = validateCatalogs(manifest, { en, ar });
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'missingKey', locale: 'en', key: 'common.period' }),
    );
  });

  test.skipIf(catalogDir === null)('a mismatched placeholder is detected', () => {
    const en = loadCatalogOrThrow('en');
    const key = Object.keys(manifest.keys).find((k) => (manifest.keys[k]?.length ?? 0) > 0);
    if (key === undefined) throw new Error('manifest declares no placeholder keys');
    const declared = manifest.keys[key] ?? [];
    const placeholder = declared[0];
    if (placeholder === undefined) throw new Error('placeholder missing');
    const ar = mutateRenamePlaceholder(loadCatalogOrThrow('ar'), key, placeholder, `${placeholder}X`);
    const issues = validateCatalogs(manifest, { en, ar });
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'placeholderMismatch', locale: 'ar', key }),
    );
  });

  test.skipIf(catalogDir === null)('a dropped Arabic plural form is detected', () => {
    const few = PLURAL_SUFFIXES[3] ?? 'few';
    const ar = mutateDropPluralForm(loadCatalogOrThrow('ar'), 'count.records', few);
    const en = loadCatalogOrThrow('en');
    const issues = validateCatalogs(manifest, { en, ar });
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'missingKey', locale: 'ar', key: 'count.records.few' }),
    );
  });
});

test('catalog pending state is explicit, never silent', ctx => {
  if (catalogDir === null) {
    console.warn(`[i18n] PENDING: ${pendingReason}`);
    ctx.skip(true, pendingReason);
  } else {
    const en = loadCatalogOrThrow('en');
    const ar = loadCatalogOrThrow('ar');
    expect(Object.keys(en).length).toBeGreaterThan(0);
    expect(Object.keys(ar).length).toBeGreaterThan(0);
  }
});
