/**
 * Minimal Compound File Binary (OLE2) detector for test inspection.
 *
 * Encrypted OOXML uploads arrive as CFB containers holding the
 * `EncryptionInfo`/`EncryptedPackage` streams; legacy binary Office files
 * are CFB too. This reader parses the header, FAT and directory entries
 * with node builtins only — enough to list stream names and classify the
 * container without touching the production parsers.
 */
import { finding, type Finding } from './findings.ts';

const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

export const isCfb = (bytes: Uint8Array): boolean =>
  bytes.length >= 8 && CFB_SIG.every((b, i) => bytes[i] === b);

export interface CfbReport {
  isCfb: boolean;
  streamNames: string[];
  findings: Finding[];
}

const u32 = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const u16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);

export function inspectCfb(bytes: Uint8Array): CfbReport {
  const findings: Finding[] = [finding('cfb.compound-file', 'error', 'OLE2/CFB container (encrypted or legacy binary Office format)')];
  const streamNames: string[] = [];
  if (bytes.length < 512) {
    findings.push(finding('cfb.malformed', 'error', `header truncated: ${bytes.length} bytes`));
    return { isCfb: true, streamNames, findings };
  }
  const sectorShift = u16(bytes, 30);
  if (u16(bytes, 28) !== 0xfffe || (sectorShift !== 9 && sectorShift !== 12)) {
    findings.push(finding('cfb.malformed', 'error', `bad byte-order/sector-shift (${u16(bytes, 28).toString(16)}/${sectorShift})`));
    return { isCfb: true, streamNames, findings };
  }
  const sectorSize = 1 << sectorShift;
  const numSectors = Math.floor((bytes.length - 512) / sectorSize);
  const sectorAt = (n: number): Uint8Array | null =>
    n < numSectors ? bytes.subarray(512 + n * sectorSize, 512 + (n + 1) * sectorSize) : null;

  // FAT sectors from the header DIFAT (covers small files; chained DIFAT
  // sectors are rare in fixtures and flagged instead of followed).
  const numFatSectors = u32(bytes, 44);
  const firstDifat = u32(bytes, 68);
  const numDifat = u32(bytes, 72);
  if (numDifat > 0 || firstDifat !== ENDOFCHAIN) {
    findings.push(finding('cfb.chained-difat', 'warning', `chained DIFAT (${numDifat} sectors) not followed`));
  }
  const fatSectorIds: number[] = [];
  for (let i = 0; i < 109 && fatSectorIds.length < numFatSectors; i += 1) {
    const id = u32(bytes, 76 + i * 4);
    if (id !== FREESECT && id !== ENDOFCHAIN) fatSectorIds.push(id);
  }
  const fat: number[] = [];
  for (const id of fatSectorIds) {
    const sec = sectorAt(id);
    if (!sec) {
      findings.push(finding('cfb.malformed', 'error', `FAT sector ${id} out of range`));
      return { isCfb: true, streamNames, findings };
    }
    for (let o = 0; o < sectorSize; o += 4) fat.push(u32(sec, o));
  }

  const firstDir = u32(bytes, 48);
  const visited = new Set<number>();
  let cur = firstDir;
  const dirBytes: number[] = [];
  while (cur !== ENDOFCHAIN && cur !== FREESECT) {
    if (visited.has(cur) || cur >= fat.length) {
      findings.push(finding('cfb.malformed', 'error', `directory chain loops or escapes at sector ${cur}`));
      return { isCfb: true, streamNames, findings };
    }
    visited.add(cur);
    const sec = sectorAt(cur);
    if (!sec) {
      findings.push(finding('cfb.malformed', 'error', `directory sector ${cur} out of range`));
      return { isCfb: true, streamNames, findings };
    }
    for (const b of sec) dirBytes.push(b);
    cur = fat[cur]!;
  }
  const dir = Uint8Array.from(dirBytes);

  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = u16(dir, o + 64);
    const type = dir[o + 66]!;
    if (nameLen < 2 || nameLen > 64 || type === 0) continue;
    const nameChars: number[] = [];
    for (let c = 0; c < nameLen - 2; c += 2) nameChars.push(u16(dir, o + c));
    const name = String.fromCharCode(...nameChars);
    streamNames.push(name);
    if (name === 'EncryptionInfo' || name === 'EncryptedPackage') {
      findings.push(finding('cfb.encryption-marker', 'error', `encryption stream ${JSON.stringify(name)} present`, name));
    }
    if (name === 'PowerPoint Document' || name === 'Workbook' || name === 'Book' || name === 'WordDocument') {
      findings.push(finding('cfb.legacy-binary', 'error', `legacy binary stream ${JSON.stringify(name)}`, name));
    }
  }
  if (streamNames.length === 0) {
    findings.push(finding('cfb.malformed', 'warning', 'no directory entries parsed'));
  }
  return { isCfb: true, streamNames, findings };
}
