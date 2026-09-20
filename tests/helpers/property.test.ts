/**
 * Self-tests for the fast-check harness: seeds are reproducible, failures
 * are captured to disk with the replay command, and the bundled
 * arbitraries actually satisfy their documented invariants.
 */
import fc from 'fast-check';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { isCanonicalDecimal, isValidDate } from '../../packages/contracts/src/index.ts';
import { scanCsv } from '../../tooling/test/csv.ts';
import {
  arbCanonicalDecimal,
  arbIsoDate,
  arbLooseDecimal,
  arbRowSpans,
  arbUnsafeCellText,
  assertProperty,
  clearFailingSeeds,
  failingSeedsPath,
  readFailingSeeds,
  resolveSeed,
  SEED_ENV,
} from './index.ts';

afterEach(() => {
  delete process.env[SEED_ENV];
  clearFailingSeeds();
});

describe('seed resolution and capture', () => {
  it('env var wins over explicit seed', () => {
    process.env[SEED_ENV] = '4242';
    expect(resolveSeed(7)).toBe(4242);
    expect(resolveSeed()).toBe(4242);
  });

  it('explicit seed used when env unset; random otherwise', () => {
    expect(resolveSeed(7)).toBe(7);
    const a = resolveSeed();
    expect(Number.isInteger(a)).toBe(true);
  });

  it('bad env seed is rejected', () => {
    process.env[SEED_ENV] = 'not-a-number';
    expect(() => resolveSeed()).toThrow(/must be an integer/);
  });

  it('a failing property records seed + replay command and rethrows', () => {
    let thrown: Error | null = null;
    try {
      assertProperty('always-fails', fc.property(fc.integer(), () => false), { seed: 991 });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.message).toContain(`${SEED_ENV}=991`);
    expect(thrown!.message).toContain('pnpm test');
    const records = readFailingSeeds();
    expect(records).toHaveLength(1);
    expect(records[0]!.name).toBe('always-fails');
    expect(records[0]!.seed).toBe(991);
    expect(existsSync(failingSeedsPath())).toBe(true);
  });

  it('same seed reproduces the same counterexample', () => {
    const run = (seed: number) =>
      fc.check(fc.property(fc.integer(), (n) => n < 500), { seed, numRuns: 50, endOnFailure: true });
    const r1 = run(31337);
    const r2 = run(31337);
    expect(r1.failed && r2.failed).toBe(true);
    expect(r1.counterexample).toEqual(r2.counterexample);
  });

  it('a passing property writes no record', () => {
    clearFailingSeeds();
    assertProperty('always-passes', fc.property(fc.integer(), () => true), { seed: 5, numRuns: 10 });
    expect(readFailingSeeds()).toEqual([]);
  });
});

describe('bundled arbitraries satisfy their invariants', () => {
  it('arbCanonicalDecimal produces only contract-canonical decimals', () => {
    assertProperty('canonical decimals', fc.property(arbCanonicalDecimal(), (s) => isCanonicalDecimal(s)), { numRuns: 300 });
  });

  it('arbLooseDecimal stays parseable (leading zeros / plus / spaces)', () => {
    assertProperty('loose decimals', fc.property(arbLooseDecimal, (s) => /^[+\-0-9.\s]+$/.test(s) && /\d/.test(s)), { numRuns: 200 });
  });

  it('arbRowSpans produces sorted disjoint non-adjacent spans with consistent rowCount', () => {
    assertProperty(
      'row spans',
      fc.property(arbRowSpans(), ({ spans, rowCount }) => {
        let prevEnd = 0;
        let sum = 0;
        for (const s of spans) {
          if (s.start < 1 || s.end < s.start) return false;
          if (s.start <= prevEnd + 1) return false; // non-adjacent
          prevEnd = s.end;
          sum += s.end - s.start + 1;
        }
        return sum === rowCount;
      }),
      { numRuns: 300 },
    );
  });

  it('arbUnsafeCellText always carries a dangerous leading byte', () => {
    assertProperty(
      'unsafe cells',
      fc.property(arbUnsafeCellText, (s) => /^[=+\-@\t\r\n]/.test(s)),
      { numRuns: 200 },
    );
  });

  it('formula-prefixed cells are actually flagged by the CSV scanner', () => {
    assertProperty(
      'formula prefix detected',
      fc.property(
        fc.tuple(fc.constantFrom('=', '+', '@'), fc.string({ unit: 'grapheme', maxLength: 30 }).filter((s) => !/["\n\r]/.test(s))),
        ([prefix, rest]) => scanCsv(`${prefix}${rest}\n`).findings.some((f) => f.code === 'csv.formula-prefix'),
      ),
      { numRuns: 100 },
    );
  });

  it('arbIsoDate produces real Gregorian dates', () => {
    assertProperty('iso dates', fc.property(arbIsoDate, (s) => isValidDate(s)), { numRuns: 300 });
  });
});
