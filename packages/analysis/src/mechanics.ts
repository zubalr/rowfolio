/**
 * Deterministic comparison mechanics: zero/negative denominator
 * discipline, Hyndman–Fan type-7 quantiles, the conservative IQR flag,
 * monotonic trend detection and chart domain bounds.
 *
 * Undefined denominators are statuses, never zeros; relative change from
 * a zero base is `not_computable`, never infinite growth.
 */
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  normalizeDecimalString,
  subtractDecimal,
} from '@rowfolio/contracts';

export type ChangeStatus = 'defined' | 'not_computable' | 'negative-base';

export interface RelativeChange {
  readonly status: ChangeStatus;
  readonly value: string | null;
  readonly absolute: string;
}

/** `(current - previous) / previous` with the contract's zero discipline. */
export function relativeChange(current: string, previous: string): RelativeChange {
  const absolute = subtractDecimal(current, previous);
  const order = compareDecimal(previous, '0');
  if (order === 0) return { status: 'not_computable', value: null, absolute };
  const value = divideDecimal(absolute, previous);
  return { status: order < 0 ? 'negative-base' : 'defined', value, absolute };
}

function floorDecimal(value: string): string {
  const dot = value.indexOf('.');
  if (dot === -1) return value;
  const int = value.slice(0, dot);
  if (value.startsWith('-') && value.slice(dot + 1).replace(/0+$/, '') !== '') {
    return subtractDecimal(int, '1');
  }
  return int === '' || int === '-' ? '0' : int;
}

/** Type-7 quantile over ascending decimal strings (linear interpolation). */
export function quantileType7(sorted: readonly string[], probability: string): string {
  const n = sorted.length;
  if (n === 0) throw new AnalysisMechanicsError('quantile of an empty set is undefined');
  if (n === 1) return sorted[0] as string;
  const h = addDecimal(multiplyDecimal(String(n - 1), probability), '1');
  const j = Number(floorDecimal(h));
  const clamped = Math.max(1, Math.min(j, n - 1));
  const g = subtractDecimal(h, String(clamped));
  const lower = sorted[clamped - 1] as string;
  const upper = sorted[clamped] as string;
  return addDecimal(lower, multiplyDecimal(g, subtractDecimal(upper, lower)));
}

export interface Distribution {
  readonly count: number;
  readonly min: string;
  readonly max: string;
  readonly median: string;
  readonly q1: string;
  readonly q3: string;
}

export function describe(values: readonly string[]): Distribution {
  const sorted = [...values].sort(compareDecimal);
  return {
    count: sorted.length,
    min: sorted[0] as string,
    max: sorted[sorted.length - 1] as string,
    median: quantileType7(sorted, '0.5'),
    q1: quantileType7(sorted, '0.25'),
    q3: quantileType7(sorted, '0.75'),
  };
}

export interface IqrVerdict {
  readonly eligible: boolean;
  readonly flagged: boolean;
  readonly reason?: string;
}

/**
 * Extreme-outlier rule: ≥30 values, IQR > 0, candidate beyond Q ± 3·IQR.
 * Says "unusual value under this rule" — never "statistically significant".
 */
export function iqrFlag(values: readonly string[], candidate: string): IqrVerdict {
  if (values.length < 30) return { eligible: false, flagged: false, reason: 'fewer-than-30-values' };
  const dist = describe(values);
  const iqr = subtractDecimal(dist.q3, dist.q1);
  if (compareDecimal(iqr, '0') === 0) {
    return { eligible: false, flagged: false, reason: 'iqr-zero-no-division' };
  }
  const lower = subtractDecimal(dist.q1, multiplyDecimal('3', iqr));
  const upper = addDecimal(dist.q3, multiplyDecimal('3', iqr));
  const flagged = compareDecimal(candidate, lower) < 0 || compareDecimal(candidate, upper) > 0;
  return { eligible: true, flagged };
}

/** Monotonic direction when all adjacent differences agree (strict). */
export function trendDirection(periodTotals: readonly string[]): 'up' | 'down' | null {
  if (periodTotals.length < 2) return null;
  let sign = 0;
  for (let i = 1; i < periodTotals.length; i += 1) {
    const diff = compareDecimal(periodTotals[i] as string, periodTotals[i - 1] as string);
    if (diff === 0) return null;
    if (sign === 0) {
      sign = diff;
    } else if (diff !== sign) {
      return null;
    }
  }
  return sign > 0 ? 'up' : 'down';
}

/** Absolute value of a decimal string. */
export function absDecimal(value: string): string {
  return compareDecimal(value, '0') < 0 ? subtractDecimal('0', value) : value;
}

/**
 * Chart domain ceiling: the smallest two-significant-figure bound at or
 * above `max × 1.1`, so axes clear the data with the contracted headroom.
 * An exact hit already provides the 10% margin; strict-above would add
 * headroom the contract does not ask for and rebaseline established
 * bounds (1,000,000 → 1,100,000). What must never happen is mis-scaled
 * rendering (e.g. 0.23 for data 1,1,2), which flattens every bar.
 */
export function domainMax(values: readonly string[]): string {
  let max = '0';
  for (const v of values) {
    const abs = v.startsWith('-') ? v.slice(1) : v;
    if (compareDecimal(abs, max) > 0) max = abs;
  }
  const stretched = multiplyDecimal(max, '1.1');
  if (compareDecimal(stretched, '0') === 0) return '10';
  const dot = stretched.indexOf('.');
  const intDigits = (dot === -1 ? stretched : stretched.slice(0, dot)).replace(/^0+/, '');
  const fracDigits = dot === -1 ? '' : stretched.slice(dot + 1);
  // Power of ten of the first significant digit, counting through
  // leading fractional zeros for sub-one magnitudes.
  const leadingFracZeros = intDigits.length > 0 ? 0 : (fracDigits.match(/^0*/) as RegExpMatchArray)[0].length;
  const k = intDigits.length > 0 ? intDigits.length - 1 : -(leadingFracZeros + 1);
  const sig = `${intDigits}${fracDigits}`.replace(/^0+/, '');
  let t = Number(sig.slice(0, 2).padEnd(2, '0'));
  let order = k - 1;
  const render = (digits: number, power: number): string => {
    const d = String(digits);
    if (power >= 0) return `${d}${'0'.repeat(power)}`;
    const right = -power;
    if (d.length > right) return `${d.slice(0, d.length - right)}.${d.slice(d.length - right)}`;
    return `0.${'0'.repeat(right - d.length)}${d}`;
  };
  let candidate = render(t, order);
  if (compareDecimal(candidate, stretched) < 0) {
    t += 1;
    if (t === 100) {
      t = 10;
      order += 1;
    }
    candidate = render(t, order);
  }
  return normalizeDecimalString(candidate);
}

export class AnalysisMechanicsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisMechanicsError';
  }
}
