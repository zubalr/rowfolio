/**
 * Deterministic metric/decimal comparison helpers (tooling/test).
 *
 * Independent of packages/contracts: canonical decimal normalization is
 * re-implemented here so a "deliberately wrong metric" planted fixture is
 * caught by two codepaths (tests/helpers asserts agreement with the real
 * normalizeDecimalString).
 */
import { finding, type Finding } from './findings.ts';

const DECIMAL_RE = /^[+-]?\d+(\.\d+)?$/;

/** Canonical decimal string: no exponent, no leading zeros, no -0. */
export function normalizeDecimal(value: string): string | null {
  if (!DECIMAL_RE.test(value)) return null;
  let s = value;
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const [intPart = '0', frac = ''] = s.split('.');
  const int = intPart.replace(/^0+(?=\d)/, '');
  // canonical form keeps the declared scale (trailing zeros are meaningful
  // for display scale), so only strip the integer side's leading zeros.
  const out = `${neg ? '-' : ''}${int}${frac.length ? '.' + frac : ''}`;
  return out === '-0' || /^-0\.0*$/.test(out) ? out.replace(/^-/, '') : out;
}

export class MetricMismatch extends Error {
  readonly code = 'metric.mismatch';
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
  constructor(field: string, expected: string, actual: string) {
    super(`metric.mismatch ${field}: expected ${expected}, got ${actual}`);
    this.name = 'MetricMismatch';
    this.field = field;
    this.expected = expected;
    this.actual = actual;
  }
}

/** Exact canonical equality — never rounding, never numeric coercion. */
export function metricEqual(actual: string, expected: string): boolean {
  const a = normalizeDecimal(actual);
  const e = normalizeDecimal(expected);
  return a !== null && e !== null && a === e;
}

export function assertMetric(actual: string, expected: string, field: string): void {
  if (!metricEqual(actual, expected)) throw new MetricMismatch(field, expected, actual);
}

/**
 * Compare a set of claimed metric values against an oracle object sharing
 * the same field names. Returns one finding per mismatch; unparseable
 * decimals are findings too (a wrong metric must fail loudly).
 */
export function compareOracleFields(
  claims: Record<string, unknown>,
  oracle: Record<string, unknown>,
  fields: readonly string[],
  path = '',
): Finding[] {
  const findings: Finding[] = [];
  for (const f of fields) {
    const a = claims[f];
    const e = oracle[f];
    if (e === undefined) {
      findings.push(finding('metric.unknown-field', 'error', `oracle has no field ${JSON.stringify(f)}`, path));
      continue;
    }
    if (typeof a !== 'string' || typeof e !== 'string') {
      findings.push(
        finding('metric.type', 'error', `${f}: expected decimal strings, got claim=${typeof a} oracle=${typeof e}`, path),
      );
      continue;
    }
    if (!metricEqual(a, e)) {
      findings.push(finding('metric.mismatch', 'error', `${f}: expected ${e}, got ${a}`, path));
    }
  }
  return findings;
}
