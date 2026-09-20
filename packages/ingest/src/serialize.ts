/**
 * Exact, deterministic serialization of JS numbers to decimal strings.
 * `String(v)` may produce exponential notation ("1e+21") — RawTable `raw`
 * values must be plain decimals, so we expand exponents instead of shipping
 * notation. Non-finite values serialize to null (callers map to 'error').
 */
export function serializeNumber(v: number): string | null {
  if (!Number.isFinite(v)) return null;
  if (Object.is(v, -0)) return '0';
  const s = String(v);
  if (!/[eE]/.test(s)) return s;
  const m = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
  if (!m) return s;
  const negative = m[1] === '-';
  const intPart = m[2] ?? '0';
  const fracPart = m[3] ?? '';
  const exp = Number.parseInt(m[4] ?? '0', 10);
  const digits = intPart + fracPart;
  const point = intPart.length + exp; // digits before the decimal point
  let out: string;
  if (point <= 0) {
    out = `0.${'0'.repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    out = digits + '0'.repeat(point - digits.length);
  } else {
    out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  if (out === '0' || /^0\.0*$/.test(out)) return '0';
  return negative ? `-${out}` : out;
}

/** Serialize a cached/formula result of unknown runtime type to a string. */
export function serializeCached(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return serializeNumber(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  if (v instanceof Date) {
    // Cell dates arrive only if a parser materializes them; keep ISO text.
    return Number.isNaN(v.getTime()) ? null : v.toISOString();
  }
  return String(v);
}
