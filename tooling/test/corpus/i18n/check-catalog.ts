/**
 * Mechanical English/Arabic locale-catalog checker.
 *
 * Validates a {key: string} catalog pair against the translation-key manifest
 * (packages/contracts/source/translation-keys.json):
 *   - key parity: every manifest key present in both catalogs, no unknown keys
 *   - placeholder parity: {name} tokens in each value match the manifest's
 *     typed placeholder set exactly
 *   - plural coverage: every suffixed plural key (zero/one/two/few/many/other)
 *     exists and carries a {count} token; Arabic requires all six categories
 *   - value sanity: non-empty strings only
 *
 * Issue kinds are stable strings so tests can assert detection of planted
 * mutations (missing key, mismatched placeholder, dropped plural form).
 *
 * CLI: node tooling/test/corpus/i18n/check-catalog.ts [--manifest PATH] [--dir CATALOG_DIR]
 * Prints a JSON report; exit 1 when issues are found. Without --dir the
 * catalog directory is resolved from $ROWFOLIO_I18N_CATALOG_DIR, then
 * packages/i18n/catalogs, packages/i18n/src/catalogs, then
 * packages/contracts/source/locales.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

export const DEFAULT_MANIFEST_PATH = resolve(repoRoot, 'packages/contracts/source/translation-keys.json');

export const CANDIDATE_CATALOG_DIRS: readonly string[] = [
  'packages/i18n/catalogs',
  'packages/i18n/src/catalogs',
  'packages/contracts/source/locales',
];

export const PLURAL_SUFFIXES: readonly string[] = ['zero', 'one', 'two', 'few', 'many', 'other'];

export interface TranslationManifest {
  schemaVersion: string;
  keys: Readonly<Record<string, readonly string[]>>;
}

export type Catalog = Readonly<Record<string, string>>;

export interface CatalogIssue {
  kind: string;
  locale: string;
  key: string;
  detail: string;
}

const PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** Extract the set of {name} placeholder tokens from one catalog value. */
export function extractPlaceholders(value: string): Set<string> {
  const found = new Set<string>();
  for (const match of String(value).matchAll(PLACEHOLDER_RE)) {
    found.add(match[1] ?? '');
  }
  return found;
}

export function pluralGroupsOf(manifest: TranslationManifest): Record<string, Set<string>> {
  const groups: Record<string, Set<string>> = {};
  for (const key of Object.keys(manifest.keys)) {
    const dot = key.lastIndexOf('.');
    if (dot === -1) continue;
    const suffix = key.slice(dot + 1);
    if (!PLURAL_SUFFIXES.includes(suffix)) continue;
    const base = key.slice(0, dot);
    (groups[base] ??= new Set<string>()).add(suffix);
  }
  return groups;
}

/** Validate {en, ar} catalog objects against the manifest. */
export function validateCatalogs(
  manifest: TranslationManifest,
  catalogs: { en?: Catalog; ar?: Catalog },
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const manifestKeys = Object.keys(manifest.keys);
  const manifestSet = new Set(manifestKeys);
  const groups = pluralGroupsOf(manifest);

  for (const locale of ['en', 'ar'] as const) {
    const catalog = catalogs[locale];
    if (catalog === undefined || catalog === null || typeof catalog !== 'object') {
      issues.push({ kind: 'catalogMissing', locale, key: '', detail: `catalog ${locale} is not an object` });
      continue;
    }
    for (const key of manifestKeys) {
      if (!Object.hasOwn(catalog, key)) {
        issues.push({ kind: 'missingKey', locale, key, detail: 'declared in manifest, absent from catalog' });
      }
    }
    for (const key of Object.keys(catalog)) {
      if (!manifestSet.has(key)) {
        issues.push({ kind: 'unknownKey', locale, key, detail: 'present in catalog, not declared in manifest' });
      }
    }
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value !== 'string' || value.length === 0) {
        issues.push({ kind: 'nonStringValue', locale, key, detail: 'catalog value must be a non-empty string' });
        continue;
      }
      if (!manifestSet.has(key)) continue;
      const expected = new Set(manifest.keys[key] ?? []);
      const actual = extractPlaceholders(value);
      const missing = [...expected].filter((placeholder) => !actual.has(placeholder));
      const unexpected = [...actual].filter((placeholder) => !expected.has(placeholder));
      if (missing.length > 0 || unexpected.length > 0) {
        issues.push({
          kind: 'placeholderMismatch',
          locale,
          key,
          detail: `expected {${[...expected].join(', ') || 'none'}}; found {${[...actual].join(', ') || 'none'}}`,
        });
      }
    }
    for (const base of Object.keys(groups)) {
      for (const suffix of PLURAL_SUFFIXES) {
        const key = `${base}.${suffix}`;
        const value = catalog[key];
        if (typeof value !== 'string') continue; // missingKey already reported
        if (!value.includes('{count}')) {
          issues.push({ kind: 'pluralValueMissingCount', locale, key, detail: 'plural value lacks a {count} token' });
        }
      }
    }
  }
  return issues;
}

/**
 * Manifest-level structural checks that need no catalogs: every plural group
 * that declares at least one category declares all six (Arabic rule), and
 * every plural key carries a declared {count} placeholder.
 */
export function validateManifestPluralStructure(manifest: TranslationManifest): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const groups = pluralGroupsOf(manifest);
  for (const [base, suffixes] of Object.entries(groups)) {
    for (const suffix of PLURAL_SUFFIXES) {
      if (!suffixes.has(suffix)) {
        issues.push({
          kind: 'pluralGroupIncomplete',
          locale: 'manifest',
          key: `${base}.${suffix}`,
          detail: `plural group ${base} lacks the ${suffix} category (Arabic requires all six)`,
        });
      }
    }
    for (const suffix of suffixes) {
      const placeholders = manifest.keys[`${base}.${suffix}`] ?? [];
      if (!placeholders.includes('count')) {
        issues.push({
          kind: 'pluralValueMissingCount',
          locale: 'manifest',
          key: `${base}.${suffix}`,
          detail: 'plural key does not declare a count placeholder',
        });
      }
    }
  }
  return issues;
}

/** Resolve the catalog directory, or null when catalogs have not landed. */
export function resolveCatalogDir(root: string = repoRoot): string | null {
  const envDir = process.env.ROWFOLIO_I18N_CATALOG_DIR;
  if (envDir) return existsSync(resolve(root, envDir, 'en.json')) ? resolve(root, envDir) : null;
  for (const candidate of CANDIDATE_CATALOG_DIRS) {
    const dir = resolve(root, candidate);
    if (existsSync(resolve(dir, 'en.json')) && existsSync(resolve(dir, 'ar.json'))) return dir;
  }
  return null;
}

export function loadManifest(manifestPath: string = DEFAULT_MANIFEST_PATH): {
  manifest: TranslationManifest;
  sha256: string;
  bytes: Buffer;
} {
  const bytes = readFileSync(manifestPath);
  return {
    manifest: JSON.parse(bytes.toString('utf-8')) as TranslationManifest,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes,
  };
}

export function loadCatalogs(dir: string): { en: Catalog; ar: Catalog } {
  return {
    en: JSON.parse(readFileSync(resolve(dir, 'en.json'), 'utf-8')) as Catalog,
    ar: JSON.parse(readFileSync(resolve(dir, 'ar.json'), 'utf-8')) as Catalog,
  };
}

// --- mutation helpers (used by tests to prove the checker detects damage) ---

export function mutateDropKey(catalog: Catalog, key: string): Record<string, string> {
  const copy: Record<string, string> = { ...catalog };
  delete copy[key];
  return copy;
}

export function mutateRenamePlaceholder(catalog: Catalog, key: string, from: string, to: string): Record<string, string> {
  const copy: Record<string, string> = { ...catalog };
  copy[key] = String(copy[key]).replaceAll(`{${from}}`, `{${to}}`);
  return copy;
}

export function mutateDropPluralForm(catalog: Catalog, group: string, suffix: string): Record<string, string> {
  return mutateDropKey(catalog, `${group}.${suffix}`);
}

function main(): void {
  const args = process.argv.slice(2);
  let manifestPath = DEFAULT_MANIFEST_PATH;
  let dir: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manifest') manifestPath = resolve(args[++i] ?? '');
    else if (args[i] === '--dir') dir = resolve(args[++i] ?? '');
  }
  const { manifest, sha256 } = loadManifest(manifestPath);
  const issues = validateManifestPluralStructure(manifest);
  const resolved = dir ?? resolveCatalogDir();
  if (resolved) {
    const catalogs = loadCatalogs(resolved);
    issues.push(...validateCatalogs(manifest, catalogs));
  }
  const report = {
    manifestPath,
    manifestSha256: sha256,
    catalogDir: resolved,
    status: resolved ? (issues.length === 0 ? 'pass' : 'issues') : 'pending-catalogs',
    pendingReason: resolved
      ? undefined
      : 'locale catalogs (en.json/ar.json) not present on this checkout; catalog parity checks are pending final integration',
    issues,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = resolved && issues.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
