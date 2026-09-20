/**
 * fixtures/hostile/generate.ts — deterministic generator for the bounded
 * synthetic hostile corpus in fixtures/hostile/native/.
 *
 *   node fixtures/hostile/generate.ts            # write artifacts + manifest
 *   node fixtures/hostile/generate.ts --verify   # regenerate in memory, diff
 *
 * Every artifact is hand-built (no third-party ZIP/OOXML libraries) so the
 * bytes are fully deterministic: store-only compression and a fixed DOS
 * timestamp mean identical output on any machine. Each artifact exists to
 * prove the inspectors in tooling/test/ detect a specific planted failure.
 * Nothing here contains real or private data — all payloads are synthetic.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, dataOffset, readZip } from '../../tooling/test/zip.ts';
import { flipByte, writeUint16LE, writeUint32LE } from '../../tooling/test/mutate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'native');

/* --------------------------------------------------------------------------
 * Minimal deterministic ZIP writer (store method 0 only — deflate output is
 * not byte-stable across zlib versions, so generated fixtures never use it).
 * Fixed DOS date 1980-01-01 keeps headers identical across runs.
 * ------------------------------------------------------------------------ */

const enc = new TextEncoder();
const DOS_DATE = 0x0021; // 1980-01-01
const DOS_TIME = 0x0000;

interface Part {
  name: string;
  data: Uint8Array;
}

const str = (s: string): Uint8Array => enc.encode(s);

function u16buf(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function u32buf(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

export function buildZip(parts: readonly Part[]): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  for (const p of parts) {
    const name = enc.encode(p.name);
    const crc = crc32(p.data);
    const localOffset = chunks.length;
    chunks.push(
      ...u32buf(0x04034b50), // local file header
      ...u16buf(20), ...u16buf(0), ...u16buf(0), // version, flags, method=store
      ...u16buf(DOS_TIME), ...u16buf(DOS_DATE),
      ...u32buf(crc), ...u32buf(p.data.length), ...u32buf(p.data.length),
      ...u16buf(name.length), ...u16buf(0),
      ...name,
      ...p.data,
    );
    central.push(
      ...u32buf(0x02014b50), // central directory record
      ...u16buf(20), ...u16buf(20), ...u16buf(0), ...u16buf(0),
      ...u16buf(DOS_TIME), ...u16buf(DOS_DATE),
      ...u32buf(crc), ...u32buf(p.data.length), ...u32buf(p.data.length),
      ...u16buf(name.length), ...u16buf(0), ...u16buf(0),
      ...u16buf(0), ...u16buf(0), ...u32buf(0), ...u32buf(localOffset),
      ...name,
    );
  }
  const cdOffset = chunks.length;
  chunks.push(...central);
  chunks.push(
    ...u32buf(0x06054b50), // EOCD
    ...u16buf(0), ...u16buf(0),
    ...u16buf(parts.length), ...u16buf(parts.length),
    ...u32buf(central.length), ...u32buf(cdOffset),
    ...u16buf(0),
  );
  return Uint8Array.from(chunks);
}

/* --------------------------------------------------------------------------
 * Minimal valid XLSX part set (the control artifact other fixtures mutate).
 * ------------------------------------------------------------------------ */

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG_REL}">
<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">
<sheets><sheet name="Ops" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG_REL}">
<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>
</Relationships>`;

const SHEET = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS_MAIN}"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>region</t></is></c><c r="B1" t="inlineStr"><is><t>revenue</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>North</t></is></c><c r="B2"><v>881000</v></c></row>
</sheetData></worksheet>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS_MAIN}"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><cellXfs count="1"><xf/></cellXfs></styleSheet>`;

const baseXlsxParts = (): Part[] => [
  { name: '[Content_Types].xml', data: str(CONTENT_TYPES) },
  { name: '_rels/.rels', data: str(ROOT_RELS) },
  { name: 'xl/workbook.xml', data: str(WORKBOOK) },
  { name: 'xl/_rels/workbook.xml.rels', data: str(WORKBOOK_RELS) },
  { name: 'xl/worksheets/sheet1.xml', data: str(SHEET) },
  { name: 'xl/styles.xml', data: str(STYLES) },
];

/* --------------------------------------------------------------------------
 * Minimal Compound File Binary holding EncryptionInfo + EncryptedPackage —
 * the signature real encrypted OOXML uploads present.
 * ------------------------------------------------------------------------ */

function buildEncryptedCfb(): Uint8Array {
  const SECTOR = 512;
  const FAT = 0, DIR = 1, ENC_INFO = 2, ENC_PKG = 10; // sector ids
  const total = SECTOR * (1 + 1 + 8 + 8);
  const out = new Uint8Array(total);
  // header
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  out.set(u16buf(0x003e), 24); // minor
  out.set(u16buf(0x0003), 26); // major = 3 (512-byte sectors)
  out.set(u16buf(0xfffe), 28); // byte order
  out.set(u16buf(9), 30); // sector shift
  out.set(u16buf(6), 32); // mini sector shift
  out.set(u32buf(1), 44); // num FAT sectors
  out.set(u32buf(DIR), 48); // first directory sector
  out.set(u32buf(4096), 56); // mini stream cutoff
  out.set(u32buf(0xfffffffe), 60); // first miniFAT
  out.set(u32buf(0xfffffffe), 68); // first DIFAT
  out.set(u32buf(FAT), 76); // DIFAT[0] -> sector 0
  for (let i = 1; i < 109; i += 1) out.set(u32buf(0xffffffff), 76 + i * 4);
  // FAT sector 0
  const fat = SECTOR + FAT * SECTOR;
  out.set(u32buf(0xfffffffd), fat); // entry 0 = FAT sector itself
  out.set(u32buf(0xfffffffe), fat + 4); // dir stream ends
  for (let s = 0; s < 7; s += 1) out.set(u32buf(ENC_INFO + s + 1), fat + 8 + s * 4);
  out.set(u32buf(0xfffffffe), fat + 8 + 7 * 4); // EncryptionInfo chain ends
  for (let s = 0; s < 7; s += 1) out.set(u32buf(ENC_PKG + s + 1), fat + 8 + 8 * 4 + s * 4);
  out.set(u32buf(0xfffffffe), fat + 8 + 8 * 4 + 7 * 4); // EncryptedPackage chain ends
  for (let i = 2 + 8 + 8; i < 128; i += 1) out.set(u32buf(0xffffffff), fat + i * 4);
  // directory sector 1: Root Entry + two streams
  const dir = SECTOR + DIR * SECTOR;
  const writeDirEntry = (idx: number, name: string, type: number, start: number, size: number): void => {
    const base = dir + idx * 128;
    const chars = enc.encode(name);
    for (let i = 0; i < chars.length; i += 1) {
      out[base + i * 2] = chars[i]!;
      out[base + i * 2 + 1] = 0;
    }
    out.set(u16buf((chars.length + 1) * 2), base + 64); // name bytes incl. NUL
    out[base + 66] = type;
    out.set(u32buf(start), base + 116);
    out.set(u32buf(size), base + 120);
  };
  writeDirEntry(0, 'Root Entry', 5, 0xfffffffe, 0);
  writeDirEntry(1, 'EncryptionInfo', 2, ENC_INFO, 4096);
  writeDirEntry(2, 'EncryptedPackage', 2, ENC_PKG, 4096);
  return out;
}

/* --------------------------------------------------------------------------
 * Artifact builders — each returns the bytes for one native/ file.
 * ------------------------------------------------------------------------ */

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

function controlXlsx(): Uint8Array {
  return buildZip(baseXlsxParts());
}

function truncatedXlsx(control: Uint8Array): Uint8Array {
  return control.slice(0, Math.floor(control.length * 0.6));
}

function badCrcXlsx(control: Uint8Array): Uint8Array {
  const zr = readZip(control);
  const sheet = zr.entries.find((e) => e.name === 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('control build broken: sheet1.xml missing');
  return flipByte(control, dataOffset(control, sheet));
}

function declaredOversizeXlsx(control: Uint8Array): Uint8Array {
  const zr = readZip(control);
  const cd = zr.centralDirectory;
  if (!cd) throw new Error('control build broken: no CD');
  // find the central-directory record for sheet1.xml and lie about its size
  const bytes = Uint8Array.from(control);
  let p = cd.offset;
  for (let i = 0; i < cd.recordCount; i += 1) {
    const nameLen = bytes[p + 28]! | (bytes[p + 29]! << 8);
    const extraLen = bytes[p + 30]! | (bytes[p + 31]! << 8);
    const commentLen = bytes[p + 32]! | (bytes[p + 33]! << 8);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name === 'xl/worksheets/sheet1.xml') {
      return writeUint32LE(bytes, p + 24, 200_000_000); // uncompressedSize field
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('control build broken: sheet1.xml not in CD');
}

function cdCountLieZip(): Uint8Array {
  const good = buildZip([{ name: 'a.txt', data: str('one') }, { name: 'b.txt', data: str('two') }]);
  const eocd = good.length - 22;
  // diskEntries (offset +8) and totalEntries (+10) are adjacent u16 fields.
  let out = writeUint16LE(good, eocd + 8, 5000);
  out = writeUint16LE(out, eocd + 10, 5000);
  return out;
}

function externalLinkXlsx(): Uint8Array {
  const ct = CONTENT_TYPES.replace(
    '</Types>',
    `<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/></Types>`,
  );
  const wbRels = WORKBOOK_RELS.replace(
    '</Relationships>',
    `<Relationship Id="rId3" Type="${NS_REL}/externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>`,
  );
  const extLink = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<externalLink xmlns="${NS_MAIN}"><externalBook r:id="rId1" xmlns:r="${NS_REL}"/></externalLink>`;
  const extRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG_REL}">
<Relationship Id="rId1" Type="${NS_REL}/externalLinkPath" Target="https://attacker.invalid/harvest.xlsx" TargetMode="External"/>
</Relationships>`;
  return buildZip([
    { name: '[Content_Types].xml', data: str(ct) },
    { name: '_rels/.rels', data: str(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: str(WORKBOOK) },
    { name: 'xl/_rels/workbook.xml.rels', data: str(wbRels) },
    { name: 'xl/worksheets/sheet1.xml', data: str(SHEET) },
    { name: 'xl/styles.xml', data: str(STYLES) },
    { name: 'xl/externalLinks/externalLink1.xml', data: str(extLink) },
    { name: 'xl/externalLinks/_rels/externalLink1.xml.rels', data: str(extRels) },
  ]);
}

function externalHyperlinkXlsx(): Uint8Array {
  const sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG_REL}">
<Relationship Id="rId1" Type="${NS_REL}/hyperlink" Target="https://attacker.invalid/track" TargetMode="External"/>
</Relationships>`;
  return buildZip([
    ...baseXlsxParts(),
    { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: str(sheetRels) },
  ]);
}

function macroXlsm(): Uint8Array {
  const ct = CONTENT_TYPES.replace(
    'spreadsheetml.sheet.main+xml',
    'vnd.ms-excel.sheet.macroEnabled.main+xml',
  );
  const wbRels = WORKBOOK_RELS.replace(
    '</Relationships>',
    `<Relationship Id="rId3" Type="${NS_REL}/vbaProject" Target="vbaProject.bin"/></Relationships>`,
  );
  return buildZip([
    { name: '[Content_Types].xml', data: str(ct) },
    { name: '_rels/.rels', data: str(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: str(WORKBOOK) },
    { name: 'xl/_rels/workbook.xml.rels', data: str(wbRels) },
    { name: 'xl/worksheets/sheet1.xml', data: str(SHEET) },
    { name: 'xl/styles.xml', data: str(STYLES) },
    { name: 'xl/vbaProject.bin', data: str('synthetic vba payload — not real code') },
  ]);
}

function nestedArchiveZip(): Uint8Array {
  const inner = buildZip([{ name: 'payload.txt', data: str('synthetic') }]);
  const mid = buildZip([{ name: 'inner.zip', data: inner }]);
  return buildZip([{ name: 'mid.zip', data: mid }]);
}

function pathTraversalZip(): Uint8Array {
  return buildZip([
    { name: '../escape.txt', data: str('traversal') },
    { name: 'C:/abs/win.txt', data: str('traversal') },
    { name: 'ok.txt', data: str('fine') },
  ]);
}

function emptyZip(): Uint8Array {
  return buildZip([]);
}

function oversizeCellCsv(): Uint8Array {
  const cell = 'x'.repeat(33_000); // > policy cellCharacters (32000)
  return str(`name,value\nrow1,${cell}\n`);
}

interface Artifact {
  file: string;
  detect: string[];
  description: string;
  build: () => Uint8Array;
}

function artifacts(control: Uint8Array): Artifact[] {
  return [
    {
      file: 'control-minimal.xlsx',
      detect: [],
      description: 'Clean minimal XLSX — positive control; must produce no error findings.',
      build: controlXlsx,
    },
    {
      file: 'corrupt-truncated.xlsx',
      detect: ['zip.no-eocd'],
      description: 'Valid XLSX truncated mid-central-directory (60% length).',
      build: () => truncatedXlsx(control),
    },
    {
      file: 'corrupt-bad-crc.xlsx',
      detect: ['zip.crc-mismatch'],
      description: 'One payload byte flipped inside xl/worksheets/sheet1.xml.',
      build: () => badCrcXlsx(control),
    },
    {
      file: 'corrupt-declared-oversize.xlsx',
      detect: ['zip.entry-declared-oversize', 'zip.expanded-exceeds-limit', 'zip.expansion-ratio', 'zip.inflate-skipped'],
      description: 'Central directory declares a 200 MB sheet while bytes stay small.',
      build: () => declaredOversizeXlsx(control),
    },
    {
      file: 'corrupt-cd-count.zip',
      detect: ['zip.entry-count', 'zip.cd-count-mismatch'],
      description: 'EOCD claims 5000 entries; two central records exist.',
      build: cdCountLieZip,
    },
    {
      file: 'external-workbook-link.xlsx',
      detect: ['ooxml.external-relationship'],
      description: 'externalLink part whose .rels points at https://attacker.invalid (TargetMode=External).',
      build: externalLinkXlsx,
    },
    {
      file: 'external-hyperlink.xlsx',
      detect: ['ooxml.external-relationship'],
      description: 'worksheet .rels carries an external hyperlink Target.',
      build: externalHyperlinkXlsx,
    },
    {
      file: 'macro-bearing.xlsm',
      detect: ['ooxml.macro-content', 'ooxml.macro-part'],
      description: 'macroEnabled content type + xl/vbaProject.bin part.',
      build: macroXlsm,
    },
    {
      file: 'nested-archive.zip',
      detect: ['zip.nested-archive'],
      description: 'zip(zip(zip(payload))) — nested archive member flagged at scan depth 1.',
      build: nestedArchiveZip,
    },
    {
      file: 'path-traversal.zip',
      detect: ['zip.path-traversal'],
      description: 'entries named ../escape.txt and C:/abs/win.txt.',
      build: pathTraversalZip,
    },
    {
      file: 'not-a-zip.xlsx',
      detect: ['inspect.unknown-signature'],
      description: 'plain text bytes renamed .xlsx — no PK/CFB signature.',
      build: () => str('this is not a zip archive, despite the extension\n'),
    },
    {
      file: 'encrypted-ooxml.xlsx',
      detect: ['cfb.compound-file', 'cfb.encryption-marker'],
      description: 'OLE2/CFB container holding EncryptionInfo + EncryptedPackage streams.',
      build: buildEncryptedCfb,
    },
    {
      file: 'empty.zip',
      detect: ['zip.empty-archive'],
      description: 'EOCD-only archive with zero entries.',
      build: emptyZip,
    },
    {
      file: 'oversize-cell.csv',
      detect: ['csv.cell-overflow'],
      description: 'single cell of 33,000 chars exceeds policy cellCharacters 32,000.',
      build: oversizeCellCsv,
    },
  ];
}

/* --------------------------------------------------------------------------
 * writer / verifier
 * ------------------------------------------------------------------------ */

function buildAll(): { name: string; bytes: Uint8Array; detect: string[]; description: string }[] {
  const control = controlXlsx();
  return artifacts(control).map((a) => ({
    name: a.file,
    bytes: a.build(),
    detect: a.detect,
    description: a.description,
  }));
}

function manifestSha256(built: { name: string; bytes: Uint8Array }[]): string {
  return built
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => `${sha256(b.bytes)}  ${b.name}`)
    .join('\n') + '\n';
}

function generationDoc(built: { name: string; bytes: Uint8Array; detect: string[]; description: string }[]): string {
  const rows = built
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => `| \`${b.name}\` | ${b.bytes.length} | \`${sha256(b.bytes).slice(0, 16)}…\` | ${b.detect.length ? b.detect.map((c) => `\`${c}\``).join(', ') : '—'} | ${b.description} |`);
  return `<!-- generated by fixtures/hostile/generate.ts — do not edit -->
# Generated hostile fixture report (native/)

Store-only ZIP construction, fixed DOS timestamp (1980-01-01) — byte-for-byte
deterministic across machines. Verify: \`node fixtures/hostile/generate.ts --verify\`.

| file | bytes | sha256 (truncated) | expected detections | purpose |
|---|---|---|---|---|
${rows.join('\n')}
`;
}

function main(argv: string[]): number {
  const verify = argv.includes('--verify');
  const built = buildAll();
  if (verify) {
    let failed = 0;
    const diskManifest = existsSync(join(OUT, 'MANIFEST.sha256'))
      ? readFileSync(join(OUT, 'MANIFEST.sha256'), 'utf8')
      : null;
    const expected = manifestSha256(built);
    if (diskManifest !== expected) {
      console.error('FAIL MANIFEST.sha256 drift');
      failed += 1;
    }
    for (const b of built) {
      const p = join(OUT, b.name);
      if (!existsSync(p)) {
        console.error(`FAIL ${b.name}: missing on disk`);
        failed += 1;
        continue;
      }
      const disk = new Uint8Array(readFileSync(p));
      if (sha256(disk) !== sha256(b.bytes)) {
        console.error(`FAIL ${b.name}: bytes differ from regeneration`);
        failed += 1;
      }
    }
    console.log(failed === 0 ? `verify ok — ${built.length} artifacts byte-identical` : `verify failed: ${failed}`);
    return failed === 0 ? 0 : 1;
  }
  mkdirSync(OUT, { recursive: true });
  for (const b of built) {
    writeFileSync(join(OUT, b.name), b.bytes);
    console.log(`wrote native/${b.name} (${b.bytes.length} B)`);
  }
  writeFileSync(join(OUT, 'MANIFEST.sha256'), manifestSha256(built));
  writeFileSync(join(OUT, 'GENERATION.md'), generationDoc(built));
  console.log('wrote native/MANIFEST.sha256 + GENERATION.md');
  return 0;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  process.exit(main(process.argv.slice(2)));
}
