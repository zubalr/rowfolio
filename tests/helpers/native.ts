/**
 * Bridge helpers exposing the independent native-file inspectors to
 * vitest suites, plus manifest-driven corpus access. The inspectors live
 * in tooling/test (no package manifest, dependency-free) so they stay
 * runnable outside vitest too.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectBytes, inspectFile, type InspectReport } from '../../tooling/test/inspect.ts';
import { hasCode, hasErrors, type Finding } from '../../tooling/test/findings.ts';
import { FIXTURES_HOSTILE, loadBytes } from './repo.ts';

export { inspectBytes, inspectFile, hasCode, hasErrors };
export type { Finding, InspectReport };

export interface ManifestFixture {
  path: string;
  inspector: 'native' | 'csv' | 'worker-response' | 'envelope' | 'progress' | 'locale' | 'metric';
  description: string;
  expect: string[];
  fields?: string[];
  oracle?: string;
  reference?: string;
  context?: { requestId: string; sessionId: string; revision: number };
}

export interface HostileManifest {
  schemaVersion: string;
  envelope: { maxFileBytes: number; maxExpandedBytes: number; maxEntries: number };
  meta: string[];
  fixtures: ManifestFixture[];
}

export function loadHostileManifest(): HostileManifest {
  return JSON.parse(readFileSync(join(FIXTURES_HOSTILE, 'manifest.json'), 'utf8')) as HostileManifest;
}

export function inspectHostileFixture(relPath: string): InspectReport {
  return inspectBytes(loadBytes(join(FIXTURES_HOSTILE, relPath)), relPath);
}

/**
 * Assert findings contain every expected code and carry no unexpected
 * error-severity codes (warnings are allowed extras — they add signal
 * without weakening the assertion).
 */
export function assertFindings(label: string, findings: readonly Finding[], expected: readonly string[]): void {
  const actual = findings.map((f) => f.code);
  const missing = expected.filter((e) => !actual.includes(e));
  if (missing.length > 0) {
    throw new Error(`${label}: missing expected findings ${missing.join(', ')} (got ${actual.join(',') || 'none'})`);
  }
  const unexpectedErrors = findings.filter((f) => f.severity === 'error' && !expected.includes(f.code));
  if (unexpectedErrors.length > 0) {
    throw new Error(`${label}: unexpected error findings ${unexpectedErrors.map((f) => f.code).join(', ')}`);
  }
}
