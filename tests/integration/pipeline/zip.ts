/**
 * Minimal ZIP reader for artifact inspection (local copy of the pattern
 * used in the writer integration tests): central directory plus
 * stored/deflated entries. Test-only; production ZIP preflight belongs
 * to the ingest lane.
 */
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number): number => view.getUint32(at, true);
  const u16 = (at: number): number => view.getUint16(at, true);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= 0; at -= 1) {
    if (u32(at) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1) throw new Error('no end-of-central-directory record');
  const count = u16(eocd + 10);
  let at = u32(eocd + 16);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i += 1) {
    if (u32(at) !== 0x02014b50) throw new Error('bad central directory signature');
    const method = u16(at + 10);
    const compSize = u32(at + 24);
    const nameLen = u16(at + 28);
    const extraLen = u16(at + 30);
    const commentLen = u16(at + 32);
    const localOffset = u32(at + 42);
    const name = Buffer.from(bytes.subarray(at + 46, at + 46 + nameLen)).toString('utf8');
    if (name.endsWith('/')) {
      at += 46 + nameLen + extraLen + commentLen;
      continue;
    }
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('bad local header');
    const dataAt = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + compSize);
    out.set(name, method === 8 ? inflateRawSync(raw) : new Uint8Array(raw));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function entryText(entries: Map<string, Uint8Array>, name: string): string {
  const data = entries.get(name);
  if (data === undefined) throw new Error(`missing ZIP entry ${name}`);
  return Buffer.from(data).toString('utf8');
}

/** Decompressed bytes per entry, in central-directory order. */
export function structuralDigest(entries: Map<string, Uint8Array>): string {
  const hash = createHash('sha256');
  for (const [name, data] of [...entries.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    hash.update(new TextEncoder().encode(name));
    hash.update(data);
  }
  return hash.digest('hex');
}
