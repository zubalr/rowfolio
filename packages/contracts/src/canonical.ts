/**
 * Canonical JSON serialization per INTERFACES.md §Identity:
 * recursively sorted object keys, preserved array order, UTF-8 without
 * whitespace, and no non-finite numbers. This serialization is the hash
 * domain input for normalizationRevision/analysisId/scenarioId/exportId —
 * producers normalize decimal strings via `normalizeDecimalString` before
 * hashing so equivalent values hash identically.
 */

export function canonicalize(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new TypeError('canonical JSON forbids non-finite numbers (NaN, Infinity)');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  if (t === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = rec[k];
      if (v === undefined) throw new TypeError(`canonical JSON forbids undefined (key ${JSON.stringify(k)})`);
      parts.push(`${JSON.stringify(k)}:${serialize(v)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new TypeError(`canonical JSON forbids ${t} values`);
}

/**
 * SHA-256 hex digest of bytes. Uses WebCrypto — available in Node ≥20,
 * browsers and workers — so it never drags a platform dependency into the
 * contracts package. `sourceHash` is SHA-256 over original source bytes;
 * semantic identity hashes use `canonicalize` output encoded as UTF-8.
 */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;
export function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}
