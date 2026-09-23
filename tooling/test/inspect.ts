/**
 * inspect.ts — single entry point for independent native-file inspection.
 *
 * CLI:   node tooling/test/inspect.ts <file...> [--json] [--require-clean]
 * Lib:   import { inspectBytes } from '../../tooling/test/inspect.ts'
 *
 * Dispatch by magic bytes: OLE2/CFB → cfb.ts; ZIP → zip.ts + (when an OOXML
 * package) ooxml.ts; anything else → unknown-signature error. Never trusts
 * file extensions.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inspectCfb, isCfb } from './cfb.ts';
import { finding, hasErrors, type Finding } from './findings.ts';
import { inspectPackage } from './ooxml.ts';
import { extractEntry, loadPolicyLimits, readZip, type ZipRead } from './zip.ts';

export interface InspectReport {
  file: string | null;
  kind: 'ooxml-xlsx' | 'ooxml-pptx' | 'ooxml-other' | 'zip-generic' | 'cfb' | 'unknown';
  byteLength: number;
  sha256: string;
  entryCount: number;
  findings: Finding[];
  ok: boolean;
}

const ZIP_SIG = (b: Uint8Array): boolean =>
  b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) && b[3] === 0x04
    ? true
    : b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x05 && b[3] === 0x06;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const k = `${f.code}|${f.path ?? ''}|${f.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function inspectBytes(bytes: Uint8Array, file: string | null = null): InspectReport {
  const base = {
    file,
    byteLength: bytes.length,
    sha256: sha256Hex(bytes),
  };
  if (isCfb(bytes)) {
    const cfb = inspectCfb(bytes);
    return { ...base, kind: 'cfb', entryCount: cfb.streamNames.length, findings: dedupe(cfb.findings), ok: !hasErrors(cfb.findings) };
  }
  if (!ZIP_SIG(bytes)) {
    const findings = [finding('inspect.unknown-signature', 'error', 'not a ZIP (PK) or OLE2/CFB signature')];
    return { ...base, kind: 'unknown', entryCount: 0, findings, ok: false };
  }

  const limits = loadPolicyLimits();
  const zip: ZipRead = readZip(bytes, limits);
  const findings: Finding[] = [...zip.findings];

  if (zip.entries.length === 0 && zip.ok) {
    findings.push(finding('zip.empty-archive', 'warning', 'archive declares zero entries'));
  }

  // Verify every entry's declared CRC/size against inflated bytes (bounded).
  for (const entry of zip.entries) {
    if (entry.flags & 0x1) continue; // encrypted entries cannot be checked
    if (entry.method !== 0 && entry.method !== 8) continue;
    const r = extractEntry(bytes, entry, limits);
    findings.push(...r.findings);
  }

  const names = new Set(zip.entries.map((e) => e.name));
  let kind: InspectReport['kind'] = 'zip-generic';
  if (names.has('[Content_Types].xml')) {
    const pkg = inspectPackage(zip, bytes);
    kind = pkg.kind;
    findings.push(...pkg.findings);
  } else if (zip.ok) {
    findings.push(finding('ooxml.missing-content-types', 'warning', 'no [Content_Types].xml — plain ZIP, not OOXML'));
  }

  const all = dedupe(findings);
  return { ...base, kind, entryCount: zip.entries.length, findings: all, ok: !hasErrors(all) };
}

export function inspectFile(path: string): InspectReport {
  return inspectBytes(new Uint8Array(readFileSync(path)), path);
}

function main(argv: string[]): number {
  const files: string[] = [];
  let requireClean = false;
  for (const a of argv) {
    if (a === '--require-clean') requireClean = true;
    else if (a === '--json') { /* JSON is the only output mode */ }
    else files.push(a);
  }
  if (files.length === 0) {
    console.error('usage: node tooling/test/inspect.ts <file...> [--require-clean]');
    return 2;
  }
  const reports = files.map(inspectFile);
  for (const r of reports) console.log(JSON.stringify(r, null, 2));
  const bad = reports.filter((r) => !r.ok);
  if (requireClean && bad.length > 0) {
    console.error(`FAIL ${bad.length}/${reports.length} files produced error findings`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
