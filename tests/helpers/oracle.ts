/**
 * Metric/oracle assertion helpers. Every comparison dual-checks the
 * contract's canonical normalizer against the independent implementation
 * in tooling/test — the independent one preserves declared scale, the
 * contract one canonicalizes, so agreement is judged on canonical value.
 */
import { join } from 'node:path';
import { normalizeDecimalString } from '../../packages/contracts/src/index.ts';
import { compareOracleFields, normalizeDecimal as independentNormalize } from '../../tooling/test/metrics.ts';
import { FIXTURES_GOLDEN, loadJson } from './repo.ts';

/** The oracle document is flat: decimal-string fields plus non-metric metadata. */
export type OracleReport = Record<string, unknown>;

export function loadOracle(file = 'oracle_report.json'): OracleReport {
  return loadJson<OracleReport>(join(FIXTURES_GOLDEN, file));
}

const DECIMAL_FIELD = /^[+-]?\d+(\.\d+)?$/;

/** Metric fields of the oracle: top-level decimal strings (excludes metadata, row lists, records). */
export function oracleFields(oracle: OracleReport): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(oracle)) {
    if (typeof v === 'string' && DECIMAL_FIELD.test(v)) out[k] = v;
  }
  return out;
}

const REJECTED = Symbol('rejected');

/**
 * Canonicalize a decimal string to contract-canonical (minimal) form.
 * The contract pattern is stricter on surface form (rejects leading
 * zeros) while the independent normalizer canonicalizes permissively —
 * agreement is required on the *value* whenever the contract accepts:
 * contract(s) must equal contract(independent(s)). When the contract
 * rejects but the independent accepts, the independent output is
 * canonicalized and returned (a strict-superset front end). When both
 * reject, TypeError.
 */
export function normalizeAgree(input: string): string {
  let contract: string | typeof REJECTED;
  try {
    contract = normalizeDecimalString(input);
  } catch {
    contract = REJECTED;
  }
  const independent = independentNormalize(input);
  if (contract !== REJECTED) {
    if (independent === null || normalizeDecimalString(independent) !== contract) {
      throw new Error(`normalizer disagreement on ${JSON.stringify(input)}: contracts=${JSON.stringify(contract)} independent=${JSON.stringify(independent)}`);
    }
    return contract;
  }
  if (independent === null) throw new TypeError(`not a decimal string: ${JSON.stringify(input)}`);
  return normalizeDecimalString(independent);
}

/** Assert actual equals expected as canonical decimal values (scale-tolerant). */
export function expectMetric(label: string, actual: string, expected: string): void {
  const a = normalizeAgree(actual);
  const e = normalizeAgree(expected);
  if (a !== e) {
    throw new Error(`metric.mismatch ${label}: actual ${JSON.stringify(actual)} → ${a} vs expected ${JSON.stringify(expected)} → ${e}`);
  }
}

export interface FieldDiff {
  field: string;
  actual: string | null;
  expected: string;
}

/**
 * Field-by-field oracle comparison. Equality is scale-strict (the oracle
 * prescribes the exact declared scale — "0.25" vs "0.2500" is a fidelity
 * defect even though the values are canonically equal). Non-decimal
 * actuals are diffs too. `fields` scopes the comparison (default: all
 * oracle decimal fields).
 */
export function oracleDiffs(
  actual: Record<string, unknown>,
  oracle: OracleReport = loadOracle(),
  fields?: readonly string[],
): FieldDiff[] {
  const of = oracleFields(oracle);
  const names = fields ?? Object.keys(of);
  const diffs: FieldDiff[] = [];
  for (const field of names) {
    const expected = of[field];
    if (expected === undefined) {
      diffs.push({ field, actual: actual[field] === undefined ? null : String(actual[field]), expected: '(absent from oracle)' });
      continue;
    }
    const a = actual[field];
    if (typeof a !== 'string' || independentNormalize(a) === null || independentNormalize(a) !== independentNormalize(expected)) {
      diffs.push({ field, actual: a === undefined ? null : String(a), expected });
    }
  }
  return diffs;
}

/** Throws listing every field whose actual ≠ oracle (value or scale). */
export function assertOracleFields(
  actual: Record<string, unknown>,
  oracle: OracleReport = loadOracle(),
  fields?: readonly string[],
): void {
  const of = oracleFields(oracle);
  const names = fields ?? Object.keys(of);
  const diffs = oracleDiffs(actual, oracle, names);
  // cross-oracle sanity: compareOracleFields is also scale-strict — it
  // must flag every field our strict check flags.
  const flagged = new Set(
    compareOracleFields(actual, of, names)
      .filter((f) => f.code === 'metric.mismatch')
      .map((f) => f.detail.split(':')[0]),
  );
  for (const d of diffs) {
    if (!flagged.has(d.field)) {
      throw new Error(`oracle disagreement: strict check flags ${d.field} but compareOracleFields accepted it`);
    }
  }
  if (diffs.length > 0) {
    throw new Error(`oracle mismatch on ${diffs.length} field(s): ` + diffs.map((d) => `${d.field}=${JSON.stringify(d.actual)} vs ${d.expected}`).join('; '));
  }
}
