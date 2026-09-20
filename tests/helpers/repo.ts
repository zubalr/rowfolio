/**
 * Shared repo/fixture plumbing for every test suite. Wire fixtures are
 * loaded with JSON.parse/readFileSync — never imported — so tests exercise
 * the same untyped values that cross the worker boundary.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELPERS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HELPERS_DIR, '..', '..');
export const FIXTURES_HOSTILE = join(REPO_ROOT, 'fixtures', 'hostile');
export const FIXTURES_SAMPLE = join(REPO_ROOT, 'fixtures', 'sample');
export const FIXTURES_GOLDEN = join(REPO_ROOT, 'fixtures', 'golden');
export const CONTRACTS_PKG = join(REPO_ROOT, 'packages', 'contracts');
export const TOOLING_TEST = join(REPO_ROOT, 'tooling', 'test');

/** Test-run artifacts (failing seeds, screenshot sidecars). Gitignored. */
export const ARTIFACTS_DIR = join(HELPERS_DIR, 'artifacts');

export function ensureArtifactsDir(sub = ''): string {
  const dir = join(ARTIFACTS_DIR, sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadJson<T = unknown>(absPath: string): T {
  return JSON.parse(readFileSync(absPath, 'utf8')) as T;
}

export function loadBytes(absPath: string): Uint8Array {
  return new Uint8Array(readFileSync(absPath));
}

export function hostileFixture(name: string): string {
  return join(FIXTURES_HOSTILE, name);
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

let headSha: string | null = null;
/** HEAD commit for evidence metadata; 'unknown' outside a git checkout. */
export function gitHeadSha(): string {
  if (headSha === null) {
    try {
      headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    } catch {
      headSha = 'unknown';
    }
  }
  return headSha;
}
