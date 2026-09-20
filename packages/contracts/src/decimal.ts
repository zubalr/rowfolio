/**
 * Exact base-ten decimal arithmetic over canonical decimal strings.
 *
 * Wire rule (INTERFACES.md): decimals cross boundaries as strings in
 * non-exponent form; canonical output forbids NaN, Infinity, exponent
 * notation and negative zero. This module is dependency-free (BigInt);
 * packages are forbidden from shipping Decimal.js (or any other arithmetic
 * library object) across package boundaries.
 *
 * Semantics mirror IEEE-754 decimal / Python `Decimal` with the contract
 * policy context: precision 40 significant digits, ROUND_HALF_UP.
 * `add`/`subtract`/`multiply` are exact; `divide` produces the exact
 * quotient when it terminates within precision, otherwise rounds to 40
 * significant digits half-up. Returned strings are canonical
 * (trailing fractional zeros stripped; `-0` folds to `0`).
 */

export const DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
export const DECIMAL_MAX_LENGTH = 100;

export const PRECISION = 40;
export const ROUNDING = 'ROUND_HALF_UP' as const;

/** Sign-magnitude representation: value = (negative ? -1 : 1) * coefficient * 10^-scale. Coefficient has no trailing zeros. */
export interface DecimalParts {
  readonly negative: boolean;
  readonly coefficient: bigint;
  readonly scale: number;
}

export class DecimalArithmeticError extends Error {
  readonly rule: 'divide-by-zero' | 'overflow';
  constructor(rule: 'divide-by-zero' | 'overflow', message: string) {
    super(message);
    this.name = 'DecimalArithmeticError';
    this.rule = rule;
  }
}

/** Parse a syntactically valid Decimal string into normalized parts. Returns null when invalid. */
export function parseDecimal(value: string): DecimalParts | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > DECIMAL_MAX_LENGTH) return null;
  if (!DECIMAL_PATTERN.test(value)) return null;
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? '' : body.slice(dot + 1);
  let coefficient = BigInt(intPart + fracPart);
  let scale = fracPart.length;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  if (coefficient === 0n) return { negative: false, coefficient: 0n, scale: 0 };
  return { negative, coefficient, scale };
}

/** Canonical wire test: pattern-valid and not negative zero. */
export function isDecimal(value: unknown): value is string {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value) || value.length > DECIMAL_MAX_LENGTH) return false;
  const p = parseDecimal(value);
  return p !== null && !(p.coefficient === 0n && value.startsWith('-'));
}

/** True when the string is in canonical (minimal) form: no trailing fractional zeros, no `-0`. */
export function isCanonicalDecimal(value: string): boolean {
  const p = parseDecimal(value);
  return p !== null && formatParts(p) === value;
}

/**
 * Significant digits as written, matching Decimal's digits-tuple semantics:
 * trailing fractional zeros count (881000.00 → 8), leading zeros never do
 * (0.001 → 1). Zero counts as 1. A normalized DecimalParts input reports its
 * normalized coefficient length.
 */
export function significantDigits(value: string | DecimalParts): number {
  if (typeof value !== 'string') return value.coefficient.toString().length;
  if (!DECIMAL_PATTERN.test(value) || value.length > DECIMAL_MAX_LENGTH) {
    throw new TypeError(`not a decimal string: ${String(value)}`);
  }
  const body = value.startsWith('-') ? value.slice(1) : value;
  const digits = body.replace('.', '').replace(/^0+/, '');
  return Math.max(1, digits.length);
}

/** True when the value respects an input significant-digit ceiling (default: policy maxInputSignificantDigits). */
export function withinSignificantDigitLimit(value: string, limit: number): boolean {
  const p = parseDecimal(value);
  return p !== null && significantDigits(p) <= limit;
}

/** Render parts as a canonical decimal string (minimal scale, `-0` folded). */
export function formatParts(p: DecimalParts): string {
  if (p.coefficient === 0n) return '0';
  const digits = p.coefficient.toString();
  let out: string;
  if (p.scale === 0) {
    out = digits;
  } else if (digits.length > p.scale) {
    out = `${digits.slice(0, digits.length - p.scale)}.${digits.slice(digits.length - p.scale)}`;
  } else {
    out = `0.${'0'.repeat(p.scale - digits.length)}${digits}`;
  }
  return p.negative ? `-${out}` : out;
}

/** Strip trailing fractional zeros and fold negative zero. Input must already satisfy DECIMAL_PATTERN. */
export function normalizeDecimalString(value: string): string {
  const p = parseDecimal(value);
  if (p === null) throw new TypeError(`not a decimal string: ${value}`);
  return formatParts(p);
}

function signed(p: DecimalParts): bigint {
  return p.negative ? -p.coefficient : p.coefficient;
}

function fromSigned(coefficient: bigint, scale: number): DecimalParts {
  let c = coefficient < 0n ? -coefficient : coefficient;
  let s = scale;
  while (s > 0 && c % 10n === 0n) {
    c /= 10n;
    s -= 1;
  }
  if (c === 0n) return { negative: false, coefficient: 0n, scale: 0 };
  return { negative: coefficient < 0n, coefficient: c, scale: s };
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** -1/0/+1 comparison of two decimal strings. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  if (pa === null || pb === null) throw new TypeError('compareDecimal requires canonical decimal strings');
  if (pa.negative !== pb.negative) return pa.negative ? -1 : 1;
  const scale = Math.max(pa.scale, pb.scale);
  const ca = pa.coefficient * pow10(scale - pa.scale);
  const cb = pb.coefficient * pow10(scale - pb.scale);
  const mag = ca < cb ? -1 : ca > cb ? 1 : 0;
  return (mag === 0 ? 0 : pa.negative ? -mag : mag) as -1 | 0 | 1;
}

export function isZeroDecimal(value: string): boolean {
  const p = parseDecimal(value);
  return p !== null && p.coefficient === 0n;
}

export function isIntegerDecimal(value: string): boolean {
  const p = parseDecimal(value);
  return p !== null && p.scale === 0;
}

/** Exact sum, canonical output. */
export function addDecimal(a: string, b: string): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  if (pa === null || pb === null) throw new TypeError('addDecimal requires canonical decimal strings');
  const scale = Math.max(pa.scale, pb.scale);
  const sum = signed(pa) * pow10(scale - pa.scale) + signed(pb) * pow10(scale - pb.scale);
  return formatParts(fromSigned(sum, scale));
}

/** Exact difference a − b, canonical output. */
export function subtractDecimal(a: string, b: string): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  if (pa === null || pb === null) throw new TypeError('subtractDecimal requires canonical decimal strings');
  const scale = Math.max(pa.scale, pb.scale);
  const diff = signed(pa) * pow10(scale - pa.scale) - signed(pb) * pow10(scale - pb.scale);
  return formatParts(fromSigned(diff, scale));
}

/** Exact product, canonical output. */
export function multiplyDecimal(a: string, b: string): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  if (pa === null || pb === null) throw new TypeError('multiplyDecimal requires canonical decimal strings');
  return formatParts(fromSigned(signed(pa) * signed(pb), pa.scale + pb.scale));
}

/**
 * Quotient a ÷ b at `precision` significant digits, ROUND_HALF_UP.
 * Throws DecimalArithmeticError('divide-by-zero') on a zero denominator —
 * callers turn that into an `undefined` result, never a clamp.
 */
export function divideDecimal(a: string, b: string, precision: number = PRECISION): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  if (pa === null || pb === null) throw new TypeError('divideDecimal requires canonical decimal strings');
  if (pb.coefficient === 0n) throw new DecimalArithmeticError('divide-by-zero', 'decimal division by zero');
  if (pa.coefficient === 0n) return '0';
  const negative = pa.negative !== pb.negative;

  // value = (cA / cB) * 10^(sB - sA)
  let numerator = pa.coefficient;
  let denominator = pb.coefficient;
  const shift = pb.scale - pa.scale;
  if (shift > 0) numerator *= pow10(shift);
  else if (shift < 0) denominator *= pow10(-shift);

  const intPart = numerator / denominator;
  let rem = numerator % denominator;
  const intDigits = intPart.toString();

  // Collect fraction digits until exact termination or precision+1 significant digits.
  const frac: number[] = [];
  let significant = intPart === 0n ? 0 : intDigits.length;
  let started = intPart !== 0n;
  while (rem > 0n && significant < precision + 1) {
    rem *= 10n;
    const d = rem / denominator;
    rem %= denominator;
    frac.push(Number(d));
    if (!started) {
      if (d === 0n) continue;
      started = true;
    }
    significant += 1;
  }

  // value = BigInt(rawDigits) * 10^E
  let digitsStr = intDigits + frac.map(String).join('');
  let exponent = -frac.length;
  let digits = BigInt(digitsStr);
  let ds = digits.toString();
  if (ds.length > precision) {
    const drop = ds.length - precision;
    const firstDropped = Number(ds[precision]);
    let kept = BigInt(ds.slice(0, precision));
    if (firstDropped >= 5) kept += 1n;
    let keptStr = kept.toString();
    if (keptStr.length > precision) {
      // carry overflow (…999 → 1000): one extra digit of precision, corrected by exponent
      keptStr = keptStr.slice(0, precision);
      exponent += 1;
    }
    exponent += drop;
    ds = keptStr;
    digits = BigInt(ds);
  }
  while (digits > 0n && digits % 10n === 0n) {
    digits /= 10n;
    exponent += 1;
  }
  return emitScientific(negative, digits.toString(), exponent);
}

/** Render digits × 10^exponent as a canonical decimal string (digits carries no point). */
function emitScientific(negative: boolean, digits: string, exponent: number): string {
  const point = digits.length + exponent; // digits to the left of the decimal point
  let out: string;
  if (point >= digits.length) {
    out = digits + '0'.repeat(point - digits.length);
  } else if (point > 0) {
    out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  } else {
    out = `0.${'0'.repeat(-point)}${digits}`;
  }
  return negative ? `-${out}` : out;
}

/** True when `value` is an exact multiple of `step` (e.g. scenario typed step 0.001). */
export function isMultipleOfStep(value: string, step: string): boolean {
  const pv = parseDecimal(value);
  const ps = parseDecimal(step);
  if (pv === null || ps === null || ps.coefficient === 0n) return false;
  const scale = Math.max(pv.scale, ps.scale);
  const cv = pv.coefficient * pow10(scale - pv.scale);
  const cs = ps.coefficient * pow10(scale - ps.scale);
  return cv % cs === 0n;
}
