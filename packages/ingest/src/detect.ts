/**
 * Byte-level format detection. Extensions and MIME types are hints only —
 * the first bytes decide (spec 15).
 *
 *   PK\x03\x04 / PK\x05\x06 / PK\x07\x08 → ZIP container → XLSX pipeline
 *   D0 CF 11 E0 A6 B1 1A E1            → OLE2 (XLS/XLSB-doc/encrypted) → UNSUPPORTED
 *   anything else                       → CSV pipeline (UTF-8 validation inside)
 */
import { IngestError } from './errors.ts';
import type { SourceFormat } from './types.ts';

const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa6, 0xb1, 0x1a, 0xe1];

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}

export function detectFormat(bytes: Uint8Array): SourceFormat {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // PK\x03\x04 local header, PK\x05\x06 empty archive EOCD, PK\x07\x08 spanned marker.
    return 'xlsx';
  }
  if (hasPrefix(bytes, OLE2_MAGIC)) {
    throw new IngestError('UNSUPPORTED', { detail: 'ole2-container' });
  }
  return 'csv';
}

/** Decoded UTF-8 text or a typed failure — CSV accepts UTF-8 only. */
export function decodeUtf8Fatal(bytes: Uint8Array, detail: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new IngestError('INVALID_FILE', { detail });
  }
}
