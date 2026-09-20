// Manifest-level mechanical checks for the frozen translation-key manifest.
// Expectations are generated from the manifest itself by
// tooling/test/corpus/i18n/generate-expectations.ts; the hash guard below
// fails when the frozen manifest changes without regenerating this suite.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  CLDR_ARABIC_CATEGORIES,
  EXPECTED_KEYS,
  EXPECTED_PLACEHOLDERS,
  EXPECTED_PLURAL_GROUPS,
  MANIFEST_SHA256,
} from './manifest-expectations.gen.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const MANIFEST_PATH = `${REPO_ROOT}packages/contracts/source/translation-keys.json`;

const liveBytes = readFileSync(MANIFEST_PATH);
const liveManifest = JSON.parse(liveBytes.toString('utf-8')) as {
  schemaVersion: string;
  keys: Record<string, readonly string[]>;
};

const CLDR_CATEGORIES: readonly string[] = CLDR_ARABIC_CATEGORIES;

function sortedEntries(record: Record<string, readonly string[]>): [string, string[]][] {
  return Object.keys(record)
    .sort()
    .map((key) => [key, [...(record[key] ?? [])].sort()] as [string, string[]]);
}

describe('frozen translation-key manifest', () => {
  test('generated expectations match the live manifest bytes (drift guard)', () => {
    const liveSha256 = createHash('sha256').update(liveBytes).digest('hex');
    expect(liveSha256, 'manifest changed: rerun node tooling/test/corpus/i18n/generate-expectations.ts').toBe(
      MANIFEST_SHA256,
    );
  });

  test('key inventory matches the generated expectation', () => {
    expect(Object.keys(liveManifest.keys).sort()).toEqual([...EXPECTED_KEYS]);
  });

  test('typed placeholder sets match the generated expectation', () => {
    const live: [string, string[]][] = Object.keys(liveManifest.keys)
      .sort()
      .map((key) => [key, [...(liveManifest.keys[key] ?? [])].sort()]);
    expect(live).toEqual(sortedEntries(EXPECTED_PLACEHOLDERS));
  });

  test('placeholder names are well-formed identifiers', () => {
    for (const key of Object.keys(liveManifest.keys)) {
      for (const placeholder of liveManifest.keys[key] ?? []) {
        expect(placeholder, `key ${key} has a malformed placeholder name`).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
      }
    }
  });

  test('plural groups match the generated expectation exactly', () => {
    const groups: Record<string, string[]> = {};
    for (const key of Object.keys(liveManifest.keys)) {
      const dot = key.lastIndexOf('.');
      const suffix = key.slice(dot + 1);
      if (!CLDR_CATEGORIES.includes(suffix)) continue;
      const base = key.slice(0, dot);
      (groups[base] ??= []).push(suffix);
    }
    const normalized = Object.fromEntries(
      Object.keys(groups)
        .sort()
        .map((base) => [base, [...(groups[base] ?? [])].sort()]),
    );
    expect(normalized).toEqual(EXPECTED_PLURAL_GROUPS);
  });

  test('every plural group covers all six Arabic categories and declares count', () => {
    for (const base of Object.keys(EXPECTED_PLURAL_GROUPS)) {
      const suffixes = EXPECTED_PLURAL_GROUPS[base] ?? [];
      expect([...suffixes].sort(), `plural group ${base} must cover all Arabic categories`).toEqual(
        [...CLDR_CATEGORIES].sort(),
      );
      for (const suffix of suffixes) {
        const placeholders = liveManifest.keys[`${base}.${suffix}`];
        expect(placeholders, `plural key ${base}.${suffix} must declare a count placeholder`).toBeDefined();
        expect(placeholders ?? []).toContain('count');
      }
    }
  });
});
