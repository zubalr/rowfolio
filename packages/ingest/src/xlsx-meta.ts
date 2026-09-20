/**
 * XLSX package inspection: classify the ZIP as a workbook (or reject it),
 * read the workbook part for sheet names/visibility/date system, resolve
 * sheet targets through .rels, and detect external content we will not touch.
 *
 * Everything reads from the validated, bounded entry map produced by
 * zip-preflight — never from the original bytes.
 */
import { IngestError } from './errors.ts';
import { decodeUtf8Fatal } from './detect.ts';
import { elements, parseAttrs, parseDimensionRef, resolveTarget, dirname, cellRefToCoords } from './xml-mini.ts';
import type { IngestLimits } from './limits.ts';
import type { SheetInfo, SheetVisibility } from './types.ts';
import { WARNINGS } from './types.ts';

const CONTENT_TYPES = '[Content_Types].xml';
const ROOT_RELS = '_rels/.rels';
const REL_OFFICE_DOCUMENT = 'officeDocument';

export interface WorkbookMeta {
  workbookPath: string;
  sheets: SheetInfo[];
  dateSystem: '1900' | '1904';
  /** Sheet target path (normalized) per sheetId for the workbook parser. */
  sheetTargets: Map<string, string>;
  /** True when the package references external/remote/embedded content. */
  hasExternalContent: boolean;
}

function utf8Text(entries: Map<string, Uint8Array>, name: string, detail: string): string {
  const bytes = entries.get(name);
  if (!bytes) throw new IngestError('INVALID_FILE', { detail });
  return decodeUtf8Fatal(bytes, detail);
}

/**
 * Reject anything that is not an unencrypted, non-macro OOXML spreadsheet.
 * Content types + entry names decide — the .xlsx extension is just a hint.
 */
function classify(entries: Map<string, Uint8Array>, contentTypes: string): void {
  const names = entries.keys();
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.includes('encryptioninfo') || lower.includes('encryptedpackage')) {
      throw new IngestError('UNSUPPORTED', { detail: 'xlsx.encrypted-package' });
    }
    if (lower.includes('vbaproject')) {
      throw new IngestError('UNSUPPORTED', { detail: 'xlsx.macro-enabled' });
    }
    if (lower === 'xl/workbook.bin' || lower.endsWith('.bin') && lower.includes('workbook')) {
      throw new IngestError('UNSUPPORTED', { detail: 'xlsx.binary-workbook' });
    }
  }
  const ct = contentTypes.toLowerCase();
  if (ct.includes('macroenabled')) {
    throw new IngestError('UNSUPPORTED', { detail: 'xlsx.macro-enabled' });
  }
  if (ct.includes('sheet.binary')) {
    throw new IngestError('UNSUPPORTED', { detail: 'xlsx.binary-workbook' });
  }
  if (ct.includes('encryptedpackage') || ct.includes('encryptioninfo')) {
    throw new IngestError('UNSUPPORTED', { detail: 'xlsx.encrypted-package' });
  }
  const mime = entries.get('mimetype');
  if (mime) {
    const text = decodeUtf8Fatal(mime, 'xlsx.mimetype-invalid').trim();
    if (text.includes('opendocument')) {
      throw new IngestError('UNSUPPORTED', { detail: 'xlsx.ods-masquerade' });
    }
  }
}

/** Locate the workbook main part: _rels/.rels officeDocument target, else content-type override. */
function findWorkbookPath(entries: Map<string, Uint8Array>, contentTypes: string): string {
  const rootRels = entries.get(ROOT_RELS);
  if (rootRels) {
    const xml = decodeUtf8Fatal(rootRels, 'xlsx.rels-invalid');
    for (const rel of elements(xml, 'Relationship')) {
      const type = rel['Type'] ?? '';
      if (type.endsWith(`/${REL_OFFICE_DOCUMENT}`) || type.endsWith(REL_OFFICE_DOCUMENT)) {
        const target = rel['Target'];
        if (target) return resolveTarget('', target);
      }
    }
  }
  for (const el of elements(contentTypes, 'Override')) {
    const type = el['ContentType'] ?? '';
    const part = el['PartName'] ?? '';
    if (type.includes('spreadsheetml.sheet.main') && part) {
      return resolveTarget('', part);
    }
  }
  throw new IngestError('UNSUPPORTED', { detail: 'xlsx.not-a-workbook' });
}

interface RelInfo {
  target: string;
  targetMode: string;
  type: string;
}

function readRels(entries: Map<string, Uint8Array>, relsPath: string): Map<string, RelInfo> {
  const map = new Map<string, RelInfo>();
  const bytes = entries.get(relsPath);
  if (!bytes) return map;
  const xml = decodeUtf8Fatal(bytes, 'xlsx.rels-invalid');
  for (const rel of elements(xml, 'Relationship')) {
    const id = rel['Id'];
    const target = rel['Target'];
    if (!id || !target) continue;
    map.set(id, {
      target,
      targetMode: rel['TargetMode'] ?? 'Internal',
      type: rel['Type'] ?? '',
    });
  }
  return map;
}

function relsPathFor(partPath: string): string {
  const dir = dirname(partPath);
  const base = partPath.slice(dir === '' ? 0 : dir.length + 1);
  return dir === '' ? `_rels/${base}.rels` : `${dir}/_rels/${base}.rels`;
}

const EXTERNAL_ENTRY_PATTERN =
  /(^|\/)(externallinks?|connections\.xml$|querytables?|webextensions?|oleobjects?|activex|embeddings?|ctrlprops?|customxml|comments?|threadedcomments?|persons|vba)/i;

function detectExternalContent(entries: Map<string, Uint8Array>): boolean {
  for (const name of entries.keys()) {
    if (EXTERNAL_ENTRY_PATTERN.test(name)) return true;
    if (name.endsWith('.rels')) {
      const bytes = entries.get(name);
      if (bytes && /TargetMode\s*=\s*"External"/i.test(decodeUtf8Fatal(bytes, 'xlsx.rels-invalid'))) {
        return true;
      }
    }
  }
  return false;
}

function sheetVisibility(state: string | undefined): SheetVisibility {
  if (state === 'hidden') return 'hidden';
  if (state === 'veryHidden') return 'very-hidden';
  return 'visible';
}

/** First `<dimension ref="...">` in the head of a sheet part. */
function sheetDimension(part: Uint8Array, scanBytes: number): SheetInfo['dimensions'] {
  const head = decodeUtf8Fatal(part.subarray(0, Math.min(part.byteLength, scanBytes)), 'xlsx.sheet-invalid-utf8');
  const m = /<(?:[A-Za-z0-9_]+:)?dimension\b[^>]*?\bref\s*=\s*("([^"]*)"|'([^']*)')/.exec(head);
  if (!m) return null;
  return parseDimensionRef(m[2] ?? m[3]);
}

/**
 * Last-resort sheet bounds when `<dimension>` is absent: scan the part for
 * the largest row index (`<row r="N">`) and widest column letter in cell
 * refs (`r="A1"`). Bounded — the part is already under the entry cap.
 */
export function scanSheetBounds(part: Uint8Array): SheetInfo['dimensions'] {
  const xml = decodeUtf8Fatal(part, 'xlsx.sheet-invalid-utf8');
  let lastRow = 0;
  let firstRow = 0;
  let lastColumn = 0;
  let firstColumn = 0;
  const rowRe = /<(?:[A-Za-z0-9_]+:)?row\b[^>]*?\br\s*=\s*"(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(xml)) !== null) {
    const r = Number.parseInt(m[1] ?? '0', 10);
    if (firstRow === 0 || r < firstRow) firstRow = r;
    if (r > lastRow) lastRow = r;
  }
  const cellRe = /<(?:[A-Za-z0-9_]+:)?c\b[^>]*?\br\s*=\s*"([A-Za-z]+)\d+"/g;
  while ((m = cellRe.exec(xml)) !== null) {
    const coord = cellRefToCoords(`${m[1]}1`);
    if (coord) {
      if (firstColumn === 0 || coord.column < firstColumn) firstColumn = coord.column;
      if (coord.column > lastColumn) lastColumn = coord.column;
    }
  }
  if (lastRow === 0) return null;
  return {
    firstRow: firstRow || 1,
    lastRow,
    firstColumn: firstColumn || 1,
    lastColumn: lastColumn || 1,
  };
}

export interface SheetXmlDisclosures {
  /** Any in-range <row hidden> — SheetJS does not populate !rows on read. */
  hiddenRowsInRange: boolean;
  /** Any in-range <col hidden> — SheetJS does not populate !cols on read. */
  hiddenColsInRange: boolean;
  /** Cells whose <f> exists but no <v> — SheetJS drops them from !data. */
  formulaOnlyCells: { row: number; column: number; formula: string }[];
}

function truthyAttr(v: string | undefined): boolean {
  return v === '1' || v === 'true';
}

interface Bounds {
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}

/**
 * Scan raw sheet XML for disclosures SheetJS never surfaces and for
 * formula-only cells it drops. One regex pass per construct; the part is
 * already bounded by the entry cap.
 */
export function scanSheetXml(part: Uint8Array, bounds: Bounds): SheetXmlDisclosures {
  const xml = decodeUtf8Fatal(part, 'xlsx.sheet-invalid-utf8');
  let hiddenRowsInRange = false;
  let hiddenColsInRange = false;
  const formulaOnlyCells: { row: number; column: number; formula: string }[] = [];

  for (const attrs of elements(xml, 'row')) {
    if (truthyAttr(attrs['hidden'])) {
      const r = Number.parseInt(attrs['r'] ?? '0', 10);
      if (r >= bounds.firstRow && r <= bounds.lastRow) hiddenRowsInRange = true;
    }
  }
  for (const attrs of elements(xml, 'col')) {
    if (truthyAttr(attrs['hidden'])) {
      const min = Number.parseInt(attrs['min'] ?? '0', 10);
      const max = Number.parseInt(attrs['max'] ?? '0', 10);
      if (Number.isFinite(min) && min <= bounds.lastColumn && max >= bounds.firstColumn) {
        hiddenColsInRange = true;
      }
    }
  }

  const cellRe = /<(?:[A-Za-z0-9_]+:)?c\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?c>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml)) !== null) {
    const inner = m[2] ?? '';
    const fm = /<(?:[A-Za-z0-9_]+:)?f\b[^>]*>([^<]*)<\//.exec(inner);
    if (!fm) continue;
    const formula = (fm[1] ?? '').trim();
    if (formula === '') continue; // shared-formula slave: no own text
    const attrs = parseAttrs(m[1] ?? '');
    const coord = cellRefToCoords(attrs['r'] ?? '');
    if (!coord) continue;
    if (coord.row < bounds.firstRow || coord.row > bounds.lastRow) continue;
    if (coord.column < bounds.firstColumn || coord.column > bounds.lastColumn) continue;
    if (/<(?:[A-Za-z0-9_]+:)?v>/.test(inner)) continue; // cached value exists → SheetJS kept it
    formulaOnlyCells.push({ row: coord.row, column: coord.column, formula });
  }

  return { hiddenRowsInRange, hiddenColsInRange, formulaOnlyCells };
}

/**
 * Read workbook metadata from the validated package entries.
 */
export function readWorkbookMeta(
  entries: Map<string, Uint8Array>,
  limits: IngestLimits,
): WorkbookMeta {
  // Not even an OOXML package — a zip that is not a workbook is UNSUPPORTED.
  if (!entries.has(CONTENT_TYPES)) {
    throw new IngestError('UNSUPPORTED', { detail: 'xlsx.not-a-workbook' });
  }
  const contentTypes = utf8Text(entries, CONTENT_TYPES, 'xlsx.content-types-invalid');
  classify(entries, contentTypes);

  const workbookPath = findWorkbookPath(entries, contentTypes);
  const workbookXml = utf8Text(entries, workbookPath, 'xlsx.workbook-missing');
  const workbookRels = readRels(entries, relsPathFor(workbookPath));
  const wbDir = dirname(workbookPath);

  let dateSystem: '1900' | '1904' = '1900';
  for (const el of elements(workbookXml, 'workbookPr')) {
    const d1904 = el['date1904'];
    if (d1904 === '1' || d1904 === 'true') dateSystem = '1904';
  }

  const sheets: SheetInfo[] = [];
  const sheetTargets = new Map<string, string>();
  let ordinal = 0;
  for (const el of elements(workbookXml, 'sheet')) {
    const name = el['name'];
    if (name === undefined) continue;
    const relId = el['r:id'] ?? el['id'] ?? '';
    const sheetId = `S${ordinal}`;
    const visibility = sheetVisibility(el['state']);

    const rel = workbookRels.get(relId);
    let dimensions: SheetInfo['dimensions'] = null;
    if (rel && rel.targetMode !== 'External') {
      const target = resolveTarget(wbDir, rel.target);
      sheetTargets.set(sheetId, target);
      const part = entries.get(target);
      if (part) {
        dimensions = sheetDimension(part, limits.dimensionScanBytes) ?? scanSheetBounds(part);
      }
    }
    sheets.push({ sheetId, ordinal, name, visibility, dimensions });
    ordinal += 1;
  }
  if (sheets.length === 0) {
    throw new IngestError('INVALID_FILE', { detail: 'xlsx.no-sheets' });
  }

  return {
    workbookPath,
    sheets,
    dateSystem,
    sheetTargets,
    hasExternalContent: detectExternalContent(entries),
  };
}

export { WARNINGS };
