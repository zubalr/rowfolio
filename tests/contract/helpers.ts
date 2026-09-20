/**
 * Shared fixture loading for the contract suite. Fixtures are wire documents —
 * loaded with JSON.parse, never imported, so the tests exercise the same
 * untyped values that cross the worker boundary.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';


const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, 'fixtures');
export const CONTRACTS_PKG = join(HERE, '..', '..', 'packages', 'contracts');

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

/** Deep clone through JSON — mutations in negative tests never share nodes. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** All rule names present in an issue list — the assertion surface for negative tests. */
export function rules(issues: readonly { rule: string }[]): string[] {
  return issues.map((i) => i.rule);
}
