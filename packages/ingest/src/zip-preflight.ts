/**
 * Bounded ZIP preflight (spec 15). Two phases:
 *
 * 1. Own central-directory scan — the CD is attacker-controlled, so every
 *    structural check happens BEFORE any inflation: entry count, per-entry
 *    declared sizes, encryption/unsupported compression flags, path
 *    normalization, traversal and duplicate detection.
 *
 * 2. Streaming inflation with real accounting — fflate `Unzip` streams each
 *    local entry; we count ACTUAL decompressed bytes per entry and
 *    cumulatively, enforce per-entry / total / ratio caps, and `terminate()`
 *    mid-stream before allocation growth. Only the validated entry set is
 *    repacked (stored, level 0) for the workbook parser — the parser never
 *    sees attacker-controlled ZIP structure.
 */
import { Unzip, UnzipInflate, UnzipPassThrough, zipSync } from 'fflate';
import type { UnzipFile } from 'fflate';
import { IngestError } from './errors.ts';
import type { IngestLimits } from './limits.ts';
import { decodeUtf8Fatal } from './detect.ts';
import { checkAbort } from './abort.ts';

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const CD_ENTRY_SIG = 0x02014b50;
const EOCD_FIXED = 22;
const EOCD_SEARCH_WINDOW = 65557; // 22 + max comment length 65535

export interface ZipEntryRecord {
  /** Name as decoded from the central directory. */
  name: string;
  /** Normalized slash path used for dedupe and package lookups. */
  normalizedName: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Directory entry (name ends with '/') — counted, bounded, never stored. */
  isDirectory: boolean;
}

export interface PreflightResult {
  /** Validated entries: normalized name → actual decompressed bytes. */
  entries: Map<string, Uint8Array>;
  /** Ordered listing of stored (non-directory) normalized names. */
  order: string[];
}

function u16(view: DataView, off: number): number {
  return view.getUint16(off, true);
}
function u32(view: DataView, off: number): number {
  return view.getUint32(off, true);
}
function u64(view: DataView, off: number): number {
  const v = view.getBigUint64(off, true);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'zip.zip64-size-overflow' });
  }
  return Number(v);
}

function findEocd(view: DataView, length: number): number {
  const start = Math.max(0, length - EOCD_SEARCH_WINDOW);
  for (let pos = length - EOCD_FIXED; pos >= start; pos -= 1) {
    if (u32(view, pos) !== EOCD_SIG) continue;
    const commentLen = u16(view, pos + 20);
    if (pos + EOCD_FIXED + commentLen === length) return pos;
  }
  throw new IngestError('INVALID_FILE', { detail: 'zip.eocd-missing' });
}

/**
 * Normalize a ZIP path to a canonical relative POSIX-style path.
 * Throws INVALID_FILE on traversal, absolute/drive paths, empty segments or
 * control characters — an XLSX package never needs them.
 */
export function normalizeZipPath(name: string): string {
  if (name.length === 0) throw new IngestError('INVALID_FILE', { detail: 'zip.path-empty' });
  for (let i = 0; i < name.length; i += 1) {
    const c = name.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      throw new IngestError('INVALID_FILE', { detail: 'zip.path-control-char' });
    }
  }
  const isDirectory = name.endsWith('/') || name.endsWith('\\');
  const segments = name.replaceAll('\\', '/').split('/');
  const out: string[] = [];
  for (const [i, seg] of segments.entries()) {
    if (seg === '') {
      if (i === segments.length - 1 && isDirectory) continue; // trailing slash
      throw new IngestError('INVALID_FILE', { detail: 'zip.path-invalid' });
    }
    if (seg === '.') throw new IngestError('INVALID_FILE', { detail: 'zip.path-invalid' });
    if (seg === '..') throw new IngestError('INVALID_FILE', { detail: 'zip.path-traversal' });
    out.push(seg);
  }
  const joined = out.join('/');
  if (/^[a-zA-Z]:/.test(joined)) {
    throw new IngestError('INVALID_FILE', { detail: 'zip.path-absolute' });
  }
  return isDirectory ? `${joined}/` : joined;
}

interface CdGeometry {
  entryCount: number;
  cdOffset: number;
}

function readCdGeometry(view: DataView, length: number): CdGeometry {
  const eocd = findEocd(view, length);
  const diskNo = u16(view, eocd + 4);
  const cdDisk = u16(view, eocd + 6);
  let entryCount = u16(view, eocd + 10);
  const cdDiskEntries = u16(view, eocd + 8);
  let cdSize = u32(view, eocd + 12);
  let cdOffset = u32(view, eocd + 16);

  const sentinels =
    entryCount === 0xffff || cdDiskEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
  if (sentinels) {
    // ZIP64: locator sits immediately before the EOCD record.
    if (eocd < 20 || u32(view, eocd - 20) !== EOCD64_LOCATOR_SIG) {
      throw new IngestError('INVALID_FILE', { detail: 'zip.zip64-locator-missing' });
    }
    const zip64Off = u64(view, eocd - 20 + 8);
    if (zip64Off + 56 > eocd || u32(view, zip64Off) !== EOCD64_SIG) {
      throw new IngestError('INVALID_FILE', { detail: 'zip.zip64-eocd-missing' });
    }
    const numDisks = u32(view, zip64Off + 16);
    const diskWithCd = u32(view, zip64Off + 20);
    entryCount = u64(view, zip64Off + 32);
    const totalEntries = u64(view, zip64Off + 24);
    cdSize = u64(view, zip64Off + 40);
    cdOffset = u64(view, zip64Off + 48);
    if (numDisks > 1 || diskWithCd !== 0 || totalEntries !== entryCount) {
      throw new IngestError('UNSUPPORTED', { detail: 'zip.multi-disk' });
    }
  } else if (diskNo !== 0 || cdDisk !== 0 || cdDiskEntries !== entryCount) {
    throw new IngestError('UNSUPPORTED', { detail: 'zip.multi-disk' });
  }
  if (cdOffset + cdSize > length) {
    throw new IngestError('INVALID_FILE', { detail: 'zip.central-directory-out-of-bounds' });
  }
  return { entryCount, cdOffset };
}

/**
 * Phase 1 — validate the central directory without inflating anything.
 */
export function scanCentralDirectory(bytes: Uint8Array, limits: IngestLimits): ZipEntryRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { entryCount, cdOffset } = readCdGeometry(view, bytes.byteLength);

  if (entryCount > limits.entries) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'zip.entries' });
  }

  const records: ZipEntryRecord[] = [];
  const seen = new Set<string>();
  let declaredTotal = 0;
  let pos = cdOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (pos + 46 > bytes.byteLength || u32(view, pos) !== CD_ENTRY_SIG) {
      throw new IngestError('INVALID_FILE', { detail: 'zip.central-directory-malformed' });
    }
    const flags = u16(view, pos + 8);
    const method = u16(view, pos + 10);
    const compressedSize = u32(view, pos + 20);
    const uncompressedSize = u32(view, pos + 24);
    const nameLen = u16(view, pos + 28);
    const extraLen = u16(view, pos + 30);
    const commentLen = u16(view, pos + 32);
    const nameStart = pos + 46;
    if (nameStart + nameLen > bytes.byteLength) {
      throw new IngestError('INVALID_FILE', { detail: 'zip.name-out-of-bounds' });
    }
    // 0xFFFFFFFF size sentinels need a ZIP64 extra field to resolve; otherwise
    // the declared sizes are ambiguous and must not be trusted.
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      const extra = bytes.subarray(nameStart + nameLen, nameStart + nameLen + extraLen);
      if (nameStart + nameLen + extraLen > bytes.byteLength || !hasZip64Extra(extra)) {
        throw new IngestError('INVALID_FILE', { detail: 'zip.size-sentinel-without-zip64' });
      }
    }
    const name = decodeUtf8Fatal(bytes.subarray(nameStart, nameStart + nameLen), 'zip.name-not-utf8');
    const normalizedName = normalizeZipPath(name);
    const isDirectory = normalizedName.endsWith('/');

    if (flags & 0x0001) throw new IngestError('UNSUPPORTED', { detail: 'zip.encrypted-entry' });
    if (flags & 0x2000) throw new IngestError('UNSUPPORTED', { detail: 'zip.masked-central-directory' });
    if (flags & 0x0020) throw new IngestError('UNSUPPORTED', { detail: 'zip.patched-data' });
    if (method !== 0 && method !== 8) {
      throw new IngestError('UNSUPPORTED', { detail: 'zip.compression-method' });
    }
    if (seen.has(normalizedName)) {
      throw new IngestError('INVALID_FILE', { detail: 'zip.duplicate-entry' });
    }
    seen.add(normalizedName);

    if (!isDirectory && uncompressedSize !== 0xffffffff) {
      declaredTotal += uncompressedSize;
      if (uncompressedSize > limits.entryBytes) {
        throw new IngestError('LIMIT_EXCEEDED', { detail: 'zip.entry-bytes' });
      }
      if (declaredTotal > limits.expandedBytes) {
        throw new IngestError('LIMIT_EXCEEDED', { detail: 'zip.expanded-bytes' });
      }
    }

    records.push({ name, normalizedName, flags, method, compressedSize, uncompressedSize, isDirectory });
    pos = nameStart + nameLen + extraLen + commentLen;
  }
  return records;
}

function hasZip64Extra(extra: Uint8Array): boolean {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let pos = 0;
  while (pos + 4 <= extra.byteLength) {
    const id = u16(view, pos);
    const size = u16(view, pos + 2);
    if (id === 0x0001) return true;
    pos += 4 + size;
  }
  return false;
}

/**
 * Phase 2 — stream local entries through fflate, accounting for ACTUAL
 * decompressed bytes. Caps terminate the stream before buffers grow.
 */
export async function inflateBounded(
  bytes: Uint8Array,
  cdRecords: readonly ZipEntryRecord[],
  limits: IngestLimits,
  signal: AbortSignal | undefined,
  progress: (fraction: number) => void,
): Promise<PreflightResult> {
  // Lookup covers ALL CD records — directories included — so a local entry
  // that has no CD counterpart is a hard anomaly, not a silent skip.
  const byName = new Map<string, ZipEntryRecord>();
  let expectedFiles = 0;
  for (const r of cdRecords) {
    byName.set(r.name, r);
    if (!r.isDirectory) expectedFiles += 1;
  }

  const entries = new Map<string, Uint8Array>();
  const order: string[] = [];

  await new Promise<void>((resolve, reject) => {
    let done = false;
    let totalExpanded = 0;
    let completed = 0;
    let currentFile: UnzipFile | null = null;
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);

    const fail = (err: unknown): void => {
      if (done) return;
      done = true;
      try {
        currentFile?.terminate();
      } catch {
        /* already stopped */
      }
      reject(err instanceof IngestError ? err : new IngestError('INVALID_FILE', { detail: 'zip.inflate-failed' }));
    };

    unzip.onfile = (file) => {
      if (done) return;
      try {
        checkAbort(signal);
      } catch (err) {
        fail(err);
        return;
      }
      const record = byName.get(file.name);
      if (!record) {
        fail(new IngestError('INVALID_FILE', { detail: 'zip.unexpected-local-entry' }));
        return;
      }
      currentFile = file;
      const entryChunks: Uint8Array[] = [];
      let entryBytes = 0;

      file.ondata = (err, data, final) => {
        if (done) return;
        try {
          if (err) throw new IngestError('INVALID_FILE', { detail: 'zip.entry-corrupt' });
          checkAbort(signal);
          entryBytes += data.byteLength;
          totalExpanded += data.byteLength;
          if (entryBytes > limits.entryBytes) {
            throw new IngestError('LIMIT_EXCEEDED', { detail: 'zip.entry-bytes' });
          }
          if (totalExpanded > limits.expandedBytes) {
            throw new IngestError('LIMIT_EXCEEDED', { detail: 'zip.expanded-bytes' });
          }
          if (totalExpanded > Math.max(bytes.byteLength, 1) * limits.expansionRatio) {
            throw new IngestError('LIMIT_EXCEEDED', { detail: 'zip.expansion-ratio' });
          }
          if (data.byteLength > 0) entryChunks.push(data.slice());
          if (final) {
            if (entryBytes !== record.uncompressedSize && record.uncompressedSize !== 0xffffffff) {
              throw new IngestError('INVALID_FILE', { detail: 'zip.size-mismatch' });
            }
            if (!record.isDirectory) {
              if (entries.has(record.normalizedName)) {
                throw new IngestError('INVALID_FILE', { detail: 'zip.duplicate-local-entry' });
              }
              entries.set(record.normalizedName, concat(entryChunks, entryBytes));
              order.push(record.normalizedName);
            }
            completed += 1;
            progress(expectedFiles === 0 ? 1 : Math.min(completed, expectedFiles) / expectedFiles);
          }
        } catch (e) {
          fail(e);
        }
      };
      // Data only streams after start(); set ondata first so nothing is missed.
      try {
        file.start();
      } catch (e) {
        fail(e);
      }
    };

    try {
      const chunk = 512 * 1024;
      for (let off = 0; off < bytes.byteLength && !done; off += chunk) {
        unzip.push(bytes.subarray(off, Math.min(off + chunk, bytes.byteLength)), false);
      }
      if (!done) unzip.push(new Uint8Array(0), true);
    } catch (err) {
      fail(err);
      return;
    }

    // Unzip callbacks are synchronous; by this point every local entry has
    // been streamed or the stream failed. Verify completeness.
    if (done) return;
    done = true;
    if (entries.size !== expectedFiles) {
      reject(new IngestError('INVALID_FILE', { detail: 'zip.truncated-archive' }));
      return;
    }
    resolve();
  });

  return { entries, order };
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1 && chunks[0]) return chunks[0];
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * Full preflight: CD scan → bounded streaming inflation → repack validated
 * entries into a stored (level-0) ZIP the workbook parser can consume without
 * trusting attacker-supplied ZIP structure.
 */
export async function preflightZip(
  bytes: Uint8Array,
  limits: IngestLimits,
  signal: AbortSignal | undefined,
  progress: (fraction: number) => void,
): Promise<{ sanitizedZip: Uint8Array; entries: Map<string, Uint8Array>; order: string[] }> {
  const cd = scanCentralDirectory(bytes, limits);
  const { entries, order } = await inflateBounded(bytes, cd, limits, signal, progress);

  const stored: Record<string, [Uint8Array, { level: 0 }]> = Object.create(null);
  for (const name of order) {
    const data = entries.get(name);
    if (data) stored[name] = [data, { level: 0 }];
  }
  const sanitizedZip = zipSync(stored);
  return { sanitizedZip, entries, order };
}
