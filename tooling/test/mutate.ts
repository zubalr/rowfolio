/**
 * Deterministic mutation helpers (tooling/test) — the planted-failure
 * battery. Every mutation is a pure byte/JSON transform; the harness
 * self-tests assert each one is detected.
 */

/** Flip one bit at a deterministic offset (defaults to first payload byte). */
export function flipByte(bytes: Uint8Array, offset = 0, mask = 0x01): Uint8Array {
  const out = Uint8Array.from(bytes);
  out[offset] = out[offset]! ^ mask;
  return out;
}

/** Truncate to a byte length (or a fraction of the original). */
export function truncateBytes(bytes: Uint8Array, at: number): Uint8Array {
  return bytes.slice(0, at);
}

/** Write a little-endian u16 into a copy of the buffer. */
export function writeUint16LE(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const out = Uint8Array.from(bytes);
  const v = value & 0xffff;
  out[offset] = v & 0xff;
  out[offset + 1] = (v >>> 8) & 0xff;
  return out;
}

/** Write a little-endian u32 into a copy of the buffer. */
export function writeUint32LE(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const out = Uint8Array.from(bytes);
  const v = value >>> 0;
  out[offset] = v & 0xff;
  out[offset + 1] = (v >>> 8) & 0xff;
  out[offset + 2] = (v >>> 16) & 0xff;
  out[offset + 3] = (v >>> 24) & 0xff;
  return out;
}

/** Deep-clone a JSON document and overwrite a dot-separated field. */
export function setJsonField<T>(doc: T, path: readonly (string | number)[], value: unknown): T {
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  let cur: Record<string, unknown> | unknown[] = clone;
  for (let i = 0; i < path.length - 1; i += 1) {
    const k = path[i]!;
    cur = (Array.isArray(cur) ? cur[Number(k)] : cur[k]) as Record<string, unknown> | unknown[];
  }
  (cur as Record<string, unknown>)[String(path[path.length - 1])] = value;
  return clone as T;
}

/** Remove a key entirely (missing-locale-key mutations). */
export function removeJsonField<T>(doc: T, path: readonly (string | number)[]): T {
  const clone = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  let cur: Record<string, unknown> | unknown[] = clone;
  for (let i = 0; i < path.length - 1; i += 1) {
    const k = path[i]!;
    cur = (Array.isArray(cur) ? cur[Number(k)] : cur[k]) as Record<string, unknown> | unknown[];
  }
  delete (cur as Record<string, unknown>)[String(path[path.length - 1])];
  return clone as T;
}
