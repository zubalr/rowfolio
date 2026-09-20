/**
 * Minimal independent ZIP reader for test inspection (tooling/test).
 *
 * Implements EOCD discovery, central-directory parsing, local-header
 * verification and bounded store/deflate extraction with CRC-32 and size
 * checks — using only node:zlib. It intentionally shares no code with the
 * production ingest path (fflate/SheetJS) so inspection verdicts are a
 * second opinion, not a re-run of the code under test.
 *
 * Extraction is policy-bounded (packages/contracts/source/policy.json):
 * entries or totals exceeding the declared limits are flagged, never
 * materialized.
 */
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { finding, hasCode, type Finding } from './findings.ts';

export interface PolicyLimits {
  compressedBytes: number;
  expandedBytes: number;
  entryBytes: number;
  entries: number;
  expansionRatio: number;
  rowsIncludingHeader: number;
  columns: number;
  nonemptyCells: number;
  visibleSheets: number;
  cellCharacters: number;
  watchdogMs: number;
  [k: string]: number;
}

export function loadPolicyLimits(): PolicyLimits {
  const url = new URL('../../packages/contracts/source/policy.json', import.meta.url);
  const policy = JSON.parse(readFileSync(url, 'utf8')) as { limits: PolicyLimits };
  return policy.limits;
}

/** The archive-specific subset. */
export type ZipLimits = Pick<PolicyLimits, 'entryBytes' | 'expandedBytes' | 'entries' | 'expansionRatio'>;

export interface ZipEntry {
  index: number;
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ZipRead {
  ok: boolean;
  entries: ZipEntry[];
  findings: Finding[];
  /** Offset/size of the central directory actually parsed. */
  centralDirectory: { offset: number; size: number; recordCount: number } | null;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_SEARCH = EOCD_MIN + 0xffff;

const u16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

const ARCHIVE_EXTENSIONS = /\.(zip|jar|xlsx|xlsm|pptx|docx|ods|odt|epub|apk)$/i;

/** Table-driven CRC-32 (IEEE) — the same polynomial every ZIP writer uses. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function checkName(name: string, index: number, findings: Finding[]): void {
  if (name.length === 0) {
    findings.push(finding('zip.empty-name', 'error', `entry ${index}: empty name`));
    return;
  }
  if ([...name].some((c) => c.charCodeAt(0) === 0)) {
    findings.push(finding('zip.bad-name', 'error', `entry ${index}: NUL byte in name`, name.slice(0, 64)));
  }
  if (
    name.includes('../') ||
    name.startsWith('../') ||
    name === '..' ||
    name.startsWith('/') ||
    name.includes('\\') ||
    /^[a-zA-Z]:/.test(name)
  ) {
    findings.push(finding('zip.path-traversal', 'error', `entry ${index}: unsafe archive path`, name));
  }
  if (ARCHIVE_EXTENSIONS.test(name)) {
    findings.push(finding('zip.nested-archive', 'warning', `entry ${index}: nested archive member`, name));
  }
}

export function readZip(bytes: Uint8Array, limits: ZipLimits = loadPolicyLimits()): ZipRead {
  const findings: Finding[] = [];
  if (bytes.length < EOCD_MIN) {
    return {
      ok: false,
      entries: [],
      findings: [finding('zip.too-small', 'error', `${bytes.length} bytes is smaller than an end-of-central-directory record`)],
      centralDirectory: null,
    };
  }

  // Locate the EOCD by scanning backwards; a ZIP comment may follow it.
  let eocd = -1;
  const lo = Math.max(0, bytes.length - EOCD_SEARCH);
  for (let i = bytes.length - EOCD_MIN; i >= lo; i -= 1) {
    if (u32(bytes, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    return {
      ok: false,
      entries: [],
      findings: [finding('zip.no-eocd', 'error', 'end-of-central-directory record not found (truncated or not a ZIP)')],
      centralDirectory: null,
    };
  }

  const diskNo = u16(bytes, eocd + 4);
  const cdDisk = u16(bytes, eocd + 6);
  if (diskNo !== 0 || cdDisk !== 0) {
    findings.push(finding('zip.multidisk', 'error', `multi-disk archive (disk ${diskNo}, cd disk ${cdDisk})`));
  }
  const declaredCount = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);

  if (cdOffset + cdSize > bytes.length) {
    findings.push(finding('zip.cd-truncated', 'error', `central directory at ${cdOffset}+${cdSize} exceeds file length ${bytes.length}`));
    return { ok: false, entries: [], findings, centralDirectory: null };
  }
  if (eocd !== cdOffset + cdSize) {
    findings.push(
      finding('zip.cd-layout', 'warning', `central directory ends at ${cdOffset + cdSize}, EOCD at ${eocd} (trailing bytes)`),
    );
  }
  if (declaredCount > limits.entries) {
    findings.push(finding('zip.entry-count', 'error', `declared ${declaredCount} entries exceeds limit ${limits.entries}`));
  }

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  let parsed = 0;
  const cdEnd = cdOffset + cdSize;
  while (p + 46 <= cdEnd && u32(bytes, p) === CEN_SIG) {
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const crc = u32(bytes, p + 16);
    const compressedSize = u32(bytes, p + 20);
    const uncompressedSize = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localHeaderOffset = u32(bytes, p + 42);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const name = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes);
    const entry: ZipEntry = {
      index: parsed,
      name,
      method,
      flags,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    };
    entries.push(entry);
    parsed += 1;

    checkName(name, parsed - 1, findings);
    if (flags & 0x1) {
      findings.push(finding('zip.encrypted-entry', 'error', `entry ${parsed - 1}: general-purpose flag bit 0 (encryption) set`, name));
    }
    if (method !== 0 && method !== 8) {
      findings.push(finding('zip.unsupported-method', 'error', `entry ${parsed - 1}: compression method ${method}`, name));
    }
    if (uncompressedSize > limits.entryBytes) {
      findings.push(
        finding(
          'zip.entry-declared-oversize',
          'error',
          `entry ${parsed - 1}: declared ${uncompressedSize} B exceeds per-entry limit ${limits.entryBytes} B`,
          name,
        ),
      );
    }
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (parsed !== declaredCount) {
    findings.push(finding('zip.cd-count-mismatch', 'error', `EOCD declares ${declaredCount} entries but ${parsed} records parsed`));
  }

  const seen = new Set<string>();
  let expandedTotal = 0;
  for (const e of entries) {
    if (seen.has(e.name)) {
      findings.push(finding('zip.duplicate-entry', 'error', `duplicate entry name`, e.name));
    }
    seen.add(e.name);
    expandedTotal += e.uncompressedSize;
  }
  if (expandedTotal > limits.expandedBytes) {
    findings.push(
      finding('zip.expanded-exceeds-limit', 'error', `declared expansion ${expandedTotal} B exceeds limit ${limits.expandedBytes} B`),
    );
  }
  if (bytes.length > 0 && expandedTotal / bytes.length > limits.expansionRatio) {
    findings.push(
      finding(
        'zip.expansion-ratio',
        'error',
        `declared expansion ratio ${(expandedTotal / bytes.length).toFixed(1)} exceeds limit ${limits.expansionRatio}`,
      ),
    );
  }

  // Verify each local header signature and name agreement.
  for (const e of entries) {
    const o = e.localHeaderOffset;
    if (o + 30 > bytes.length || u32(bytes, o) !== LOC_SIG) {
      findings.push(finding('zip.bad-local-signature', 'error', `entry ${e.index}: no local file header at offset ${o}`, e.name));
      continue;
    }
    const lNameLen = u16(bytes, o + 26);
    const lName = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(o + 30, o + 30 + lNameLen));
    if (lName !== e.name) {
      findings.push(finding('zip.local-name-mismatch', 'error', `entry ${e.index}: local name ${JSON.stringify(lName)}`, e.name));
    }
  }

  return {
    ok: !findings.some((f) => f.severity === 'error'),
    entries,
    findings,
    centralDirectory: { offset: cdOffset, size: cdSize, recordCount: parsed },
  };
}

/**
 * Byte offset of an entry's central-directory record, or -1. Used by
 * mutation builders/tests that patch declared CD fields.
 */
export function cdEntryOffset(bytes: Uint8Array, zr: ZipRead, name: string): number {
  if (!zr.centralDirectory) return -1;
  const end = zr.centralDirectory.offset + zr.centralDirectory.size;
  let p = zr.centralDirectory.offset;
  const text = new TextDecoder();
  while (p + 46 <= end && p + 46 <= bytes.length && u32(bytes, p) === CEN_SIG) {
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const n = text.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (n === name) return p;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return -1;
}

export interface ExtractResult {
  data: Uint8Array | null;
  findings: Finding[];
}

/** Byte offset where an entry's compressed payload starts. */
export function dataOffset(bytes: Uint8Array, entry: ZipEntry): number {
  const o = entry.localHeaderOffset;
  const nameLen = u16(bytes, o + 26);
  const extraLen = u16(bytes, o + 28);
  return o + 30 + nameLen + extraLen;
}

/** Bounded extract: refuses to inflate anything over the declared limits. */
export function extractEntry(bytes: Uint8Array, entry: ZipEntry, limits: ZipLimits = loadPolicyLimits()): ExtractResult {
  const findings: Finding[] = [];
  if (entry.uncompressedSize > limits.entryBytes) {
    findings.push(finding('zip.inflate-skipped', 'error', `refusing to inflate ${entry.uncompressedSize} B (over limit)`, entry.name));
    return { data: null, findings };
  }
  const start = dataOffset(bytes, entry);
  if (start + entry.compressedSize > bytes.length) {
    findings.push(finding('zip.truncated-data', 'error', `entry data at ${start}+${entry.compressedSize} exceeds file`, entry.name));
    return { data: null, findings };
  }
  const raw = bytes.subarray(start, start + entry.compressedSize);
  let data: Uint8Array;
  if (entry.method === 0) {
    data = Uint8Array.from(raw);
  } else if (entry.method === 8) {
    try {
      data = new Uint8Array(inflateRawSync(raw, { maxOutputLength: limits.entryBytes + 1 }));
    } catch (err) {
      findings.push(finding('zip.inflate-error', 'error', `deflate failed: ${(err as Error).message}`, entry.name));
      return { data: null, findings };
    }
  } else {
    findings.push(finding('zip.unsupported-method', 'error', `compression method ${entry.method}`, entry.name));
    return { data: null, findings };
  }
  if (data.length !== entry.uncompressedSize) {
    findings.push(
      finding('zip.size-mismatch', 'error', `expanded ${data.length} B but directory declares ${entry.uncompressedSize} B`, entry.name),
    );
  }
  const actual = crc32(data);
  if (actual !== entry.crc32) {
    findings.push(
      finding('zip.crc-mismatch', 'error', `crc32 ${actual.toString(16)} != directory ${entry.crc32.toString(16)}`, entry.name),
    );
  }
  return { data, findings };
}

export function hasFinding(findings: readonly Finding[], code: string): boolean {
  return hasCode(findings, code);
}
