/**
 * Deterministic property-test helpers built on fast-check.
 *
 * Every property runs under an explicit seed so failures are reproducible:
 * the seed comes from ROWFOLIO_FC_SEED (then FC_SEED) when set, else from
 * fast-check's own PRNG — and is always captured. A failing property
 * appends { name, seed, path, counterexample } to
 * tests/helpers/artifacts/failing-seeds.jsonl and rethrows with the exact
 * replay command, so a CI failure is one env var away from a local rerun.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { ensureArtifactsDir } from './repo.ts';

export const SEED_ENV = 'ROWFOLIO_FC_SEED';
export const FAILING_SEEDS_FILE = 'failing-seeds.jsonl';

function envSeed(): number | null {
  const raw = process.env[SEED_ENV] ?? process.env['FC_SEED'];
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${SEED_ENV}/FC_SEED must be an integer, got ${JSON.stringify(raw)}`);
  return n;
}

/** Resolve the seed for one run: explicit > env > fresh random. */
export function resolveSeed(explicit?: number): number {
  const env = envSeed();
  if (env !== null) return env;
  if (explicit !== undefined) return explicit;
  return Math.floor(Math.random() * 2 ** 31);
}

export function failingSeedsPath(): string {
  return join(ensureArtifactsDir(), FAILING_SEEDS_FILE);
}

export function readFailingSeeds(): { name: string; seed: number; path: string | null; counterexample: unknown }[] {
  const p = failingSeedsPath();
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Remove the capture file — call in beforeEach for capture tests. */
export function clearFailingSeeds(): void {
  const p = failingSeedsPath();
  if (existsSync(p)) rmSync(p);
}

export interface PropertyOptions {
  /** Explicit seed; env vars still win so CI can force replays. */
  seed?: number;
  numRuns?: number;
  /** Where the failure record goes (default: artifacts/failing-seeds.jsonl). */
  captureFile?: string;
}

/**
 * Run a fast-check property under a captured seed. On failure the JSONL
 * record lands on disk first, then an error carrying the replay command.
 */
export function assertProperty<T>(
  name: string,
  property: fc.IProperty<T>,
  opts: PropertyOptions = {},
): void {
  const seed = resolveSeed(opts.seed);
  const run = fc.check(property, { seed, numRuns: opts.numRuns ?? 100, endOnFailure: true });
  if (!run.failed) return;
  const captureFile = opts.captureFile ?? failingSeedsPath();
  mkdirSync(join(captureFile, '..'), { recursive: true });
  const record = {
    name,
    seed: run.seed ?? seed,
    path: run.counterexamplePath ?? null,
    counterexample: safeJson(run.counterexample),
    numRuns: run.numRuns,
  };
  appendFileSync(captureFile, JSON.stringify(record) + '\n');
  throw new Error(
    `property ${JSON.stringify(name)} failed after ${run.numRuns} runs\n` +
      `  counterexample: ${JSON.stringify(run.counterexample)}\n` +
      `  reproduce: ${SEED_ENV}=${run.seed ?? seed} pnpm test  (recorded in ${captureFile})`,
  );
}

const safeJson = (v: unknown): unknown => {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
};

/* --------------------------------- arbitraries --------------------------------- */

/** Canonical decimal strings only: no exponent, no leading zeros, no -0. */
export const arbCanonicalDecimal = (maxIntDigits = 18, maxFracDigits = 6): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc.boolean(),
      fc.oneof(
        fc.constant('0'),
        fc
          .tuple(fc.integer({ min: 1, max: 9 }), fc.string({ unit: fc.constantFrom(...'0123456789'.split('')), maxLength: maxIntDigits - 1 }))
          .map(([f, r]) => `${f}${r}`),
      ),
      // canonical scale: a fractional part may not end in '0'
      fc.oneof(
        fc.constant(''),
        fc
          .tuple(
            fc.string({ unit: fc.constantFrom(...'0123456789'.split('')), maxLength: maxFracDigits - 1 }),
            fc.integer({ min: 1, max: 9 }),
          )
          .map(([r, last]) => `${r}${last}`),
      ),
    )
    .map(([neg, int, frac]) => `${neg ? '-' : ''}${int}${frac.length ? `.${frac}` : ''}`)
    .filter((s) => s !== '-0' && !/^-0\.0*$/.test(s));

/** Deliberately non-canonical decimals (leading zeros, + sign) for normalization tests. */
export const arbLooseDecimal: fc.Arbitrary<string> = fc
  .tuple(arbCanonicalDecimal(), fc.constantFrom('plus', 'zeros', 'spaces', 'raw'))
  .map(([s, mode]) => {
    if (mode === 'plus') return `+${s}`;
    if (mode === 'zeros') return `0${s}`;
    if (mode === 'spaces') return ` ${s} `;
    return s;
  });

export interface SpansModel {
  spans: { start: number; end: number }[];
  rowCount: number;
}

/** Sorted, disjoint, non-adjacent 1-based spans with consistent rowCount. */
export function arbRowSpans(maxSpans = 5, maxLen = 40): fc.Arbitrary<SpansModel> {
  return fc
    .array(fc.tuple(fc.integer({ min: 1, max: maxLen }), fc.integer({ min: 1, max: 12 })), { maxLength: maxSpans })
    .map((parts) => {
      const spans: SpansModel['spans'] = [];
      let next = 1;
      let rowCount = 0;
      for (const [len, gap] of parts) {
        next += gap;
        spans.push({ start: next, end: next + len - 1 });
        next += len;
        rowCount += len;
      }
      return { spans, rowCount };
    });
}

/** Cell text with CSV-injection-active leading characters and tricky bytes. */
export const arbUnsafeCellText: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('=', '+', '-', '@', '\t', '\r\n'),
    fc.string({ unit: 'grapheme', minLength: 0, maxLength: 60 }),
  )
  .map(([prefix, rest]) => prefix + rest);

/** Real Gregorian dates only (validates leap years) as ISO date strings. */
export const arbIsoDate: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 1900, max: 2100 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 31 }),
  )
  .filter(([y, m, d]) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  })
  .map(([y, m, d]) => `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`);
