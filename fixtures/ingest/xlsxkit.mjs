/* global TextEncoder */
/**
 * xlsxkit — minimal real OOXML workbook assembler for ingest fixtures.
 *
 * Writes genuinely valid packages (SheetJS parses them) while allowing exact
 * control over the parts real tools won't produce on demand: hidden sheets,
 * merges, date systems, formula cells with/without caches, external links,
 * macro/encryption markers. Content here is synthetic by design.
 */
import { buildZip } from './zipkit.mjs';

const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const MIME = {
  workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  worksheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  styles: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  sharedStrings: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
  xml: 'application/xml',
  externalLink: 'application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml',
};

const REL = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  worksheet: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  sharedStrings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings',
  externalLink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink',
  externalLinkPath: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath',
};

const colName = (c) => {
  let s = '';
  let n = c;
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
};

/**
 * Build a minimal xlsx.
 * spec: {
 *   sheets: [{ name, hidden?, veryHidden?, rows: [[cell,...]], merges?: [], hiddenRows?: [], hiddenCols?: [] }],
 *   date1904?: bool,
 *   macro?: bool, externalLinks?: bool,
 *   sharedStrings?: auto-collected,
 * }
 * cell: string | number | boolean | { t:'f', f, v? } | { t:'e', v } | { t:'s', v } |
 *       { t:'d', serial, fmt } | { t:'n', v, fmt? } | null
 */
export function buildXlsx(spec) {
  const sharedStrings = [];
  const sstIndex = new Map();
  const sstOf = (v) => {
    if (!sstIndex.has(v)) {
      sstIndex.set(v, sharedStrings.length);
      sharedStrings.push(v);
    }
    return sstIndex.get(v);
  };

  const sheetXmls = spec.sheets.map((sheet) => {
    const rowsXml = [];
    let maxRow = 0;
    let maxCol = 0;
    const hiddenRows = new Set(sheet.hiddenRows ?? []);
    const hiddenCols = new Set(sheet.hiddenCols ?? []);
    for (const [ri, row] of sheet.rows.entries()) {
      const r = ri + 1;
      maxRow = r;
      const cellsXml = [];
      for (const [ci, cell] of row.entries()) {
        if (cell === null || cell === undefined) continue;
        const c = ci + 1;
        if (c > maxCol) maxCol = c;
        const ref = `${colName(c)}${r}`;
        cellsXml.push(cellXml(ref, cell, sstOf));
      }
      const hiddenAttr = hiddenRows.has(r) ? ' hidden="1"' : '';
      rowsXml.push(`<row r="${r}"${hiddenAttr}>${cellsXml.join('')}</row>`);
    }
    const colsXml =
      hiddenCols.size > 0
        ? `<cols>${[...hiddenCols].map((c) => `<col min="${c}" max="${c}" width="12" hidden="1"/>`).join('')}</cols>`
        : '';
    const mergesXml =
      sheet.merges && sheet.merges.length > 0
        ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
        : '';
    const dim = `A1:${colName(Math.max(maxCol, 1))}${Math.max(maxRow, 1)}`;
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<dimension ref="${dim}"/>${colsXml}<sheetData>${rowsXml.join('')}</sheetData>${mergesXml}</worksheet>`
    );
  });

  const date1904 = spec.date1904 ? ' date1904="1"' : '';
  const sheetsXml = spec.sheets
    .map((s, i) => {
      const state = s.veryHidden ? 'veryHidden' : s.hidden ? 'hidden' : undefined;
      return `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${state ? ` state="${state}"` : ''} r:id="rId${i + 1}"/>`;
    })
    .join('');

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<workbookPr${date1904}/><sheets>${sheetsXml}</sheets></workbook>`;

  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    spec.sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL.worksheet}" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('') +
    `<Relationship Id="rId${spec.sheets.length + 1}" Type="${REL.styles}" Target="styles.xml"/>` +
    `<Relationship Id="rId${spec.sheets.length + 2}" Type="${REL.sharedStrings}" Target="sharedStrings.xml"/>` +
    (spec.externalLinks
      ? `<Relationship Id="rId${spec.sheets.length + 3}" Type="${REL.externalLink}" Target="externalLinks/externalLink1.xml"/>`
      : '') +
    `</Relationships>`;

  const overrides =
    spec.sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${MIME.worksheet}"/>`)
      .join('') +
    `<Override PartName="/xl/styles.xml" ContentType="${MIME.styles}"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="${MIME.sharedStrings}"/>` +
    (spec.externalLinks
      ? `<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="${MIME.externalLink}"/>`
      : '');

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="${MIME.rels}"/>` +
    `<Default Extension="xml" ContentType="${MIME.xml}"/>` +
    `<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="${spec.macro ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml' : MIME.workbook}"/>` +
    overrides +
    `</Types>`;

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts>` +
    `<fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/>` +
    `</cellXfs></styleSheet>`;

  const sstXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">` +
    sharedStrings.map((s) => `<si><t>${esc(s)}</t></si>`).join('') +
    `</sst>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL.officeDocument}" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const files = [
    { name: '[Content_Types].xml', data: enc(contentTypes) },
    { name: '_rels/.rels', data: enc(rootRels) },
    { name: 'xl/workbook.xml', data: enc(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc(wbRels) },
    { name: 'xl/styles.xml', data: enc(stylesXml) },
    { name: 'xl/sharedStrings.xml', data: enc(sstXml) },
    ...sheetXmls.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(xml) })),
  ];

  if (spec.externalLinks) {
    files.push(
      { name: 'xl/externalLinks/externalLink1.xml', data: enc(`<?xml version="1.0"?><externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><externalBook r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></externalLink>`) },
      { name: 'xl/externalLinks/_rels/externalLink1.xml.rels', data: enc(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL.externalLinkPath}" Target="https://example.invalid/book.xlsx" TargetMode="External"/></Relationships>`) },
    );
  }
  if (spec.macro) {
    files.push({ name: 'xl/vbaProject.bin', data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) });
  }
  return buildZip(files);
}

const enc = (s) => new TextEncoder().encode(s);

// style indexes: 0 general, 1 numFmt 164 (yyyy-mm-dd), 2 builtin 14, 3 numFmt 165 (0.00)
function cellXml(ref, cell, sstOf) {
  if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
  if (typeof cell === 'boolean') return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
  if (typeof cell === 'string') return `<c r="${ref}" t="s"><v>${sstOf(cell)}</v></c>`;
  if (cell && typeof cell === 'object') {
    switch (cell.t) {
      case 'f': {
        const v = cell.v !== undefined ? `<v>${cell.v}</v>` : '';
        return `<c r="${ref}"><f>${esc(cell.f)}</f>${v}</c>`;
      }
      case 'e':
        return `<c r="${ref}" t="e"><v>${esc(cell.v)}</v></c>`;
      case 's':
        return `<c r="${ref}" t="s"><v>${sstOf(cell.v)}</v></c>`;
      case 'd':
        return `<c r="${ref}" s="${cell.fmt === 14 ? 2 : 1}"><v>${cell.serial}</v></c>`;
      case 'n':
        return `<c r="${ref}"${cell.fmt !== undefined ? ` s="${cell.fmt}"` : ''}><v>${cell.v}</v></c>`;
      case 'z':
        return `<c r="${ref}" s="0"/>`;
      default:
        return '';
    }
  }
  return '';
}
