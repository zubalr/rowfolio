/* global Buffer, TextEncoder */
/**
 * zipkit — zero-dependency deterministic ZIP writer for ingest fixtures.
 *
 * Deliberately hand-rolled so tests can produce zips real libraries refuse
 * to write: forged general-purpose flags (encryption bit), duplicate entry
 * names, path traversal names, arbitrary compression methods and declared
 * size lies. Only used by fixture generators — never shipped to runtime.
 */
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

/**
 * entry: {
 *   name: string|Uint8Array   raw name bytes (string is utf-8 encoded)
 *   data: Uint8Array          uncompressed content
 *   method: 0|8|99            compression method (default deflate when data)
 *   flags: number             general-purpose bit flag override
 *   declaredCompressedSize?: number  lie for CD (defaults to real)
 *   declaredUncompressedSize?: number
 *   extra?: Uint8Array        local+central extra bytes
 * }
 */
export function buildZip(entries, { comment = '' } = {}) {
  const encoder = new TextEncoder();
  const localParts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const name = e.name instanceof Uint8Array ? e.name : encoder.encode(e.name);
    const data = e.data ?? new Uint8Array(0);
    const method = e.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(data, { level: 9 }) : data;
    const flags = e.flags ?? 0x0800; // UTF-8 names
    const crc = crc32(data);
    const declaredC = e.declaredCompressedSize ?? compressed.length;
    const declaredU = e.declaredUncompressedSize ?? data.length;
    const extra = e.extra ?? new Uint8Array(0);

    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method),
      ...u16(0), ...u16(0), ...u32(crc), ...u32(compressed.length), ...u32(data.length),
      ...u16(name.length), ...u16(extra.length),
    ]);
    localParts.push(local, name, extra, compressed);

    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method),
      ...u16(0), ...u16(0), ...u32(crc), ...u32(declaredC), ...u32(declaredU),
      ...u16(name.length), ...u16(extra.length), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
    ]), name, extra);

    offset += local.length + name.length + extra.length + compressed.length;
  }

  const cd = Buffer.concat(central);
  const cdOffset = offset;
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(cd.length), ...u32(cdOffset), ...u16(comment.length),
    ...encoder.encode(comment),
  ]);
  return Buffer.concat([...localParts, cd, eocd]);
}

/** Concat helper for malformed fixtures. */
export function zipBytes(...parts) {
  return Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf8') : p)));
}

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
