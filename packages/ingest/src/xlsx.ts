/**
 * XLSX adapter: bounded ZIP preflight → package classification → SheetJS
 * parse of the sanitized package → deterministic RawCell emission with
 * physical 1-based coordinates.
 *
 * Formulas are preserved as text (`cell.f`) plus an optional serialized
 * cached value — never evaluated. Dates stay raw serial strings tagged
 * 'date' with the workbook's dateSystem metadata; conversion is a
 * normalize-layer decision. External links, embedded objects and remote
 * references are detected and disclosed, never resolved.
 */
import * as XLSX from 'xlsx';
import type { RawCell, RawTable, SourceRef } from '@rowfolio/contracts';
import { checkRawTable, sha256Hex } from '@rowfolio/contracts';
import { IngestError } from './errors.ts';
import type { IngestLimits } from './limits.ts';
import { checkAbort, yieldToEventLoop } from './abort.ts';
import { preflightZip } from './zip-preflight.ts';
import { readWorkbookMeta, scanSheetXml, type WorkbookMeta } from './xlsx-meta.ts';
import { serializeCached, serializeNumber } from './serialize.ts';
import type { IngestExtras, ParseOptions, Progress, SheetInfo } from './types.ts';
import { WARNINGS } from './types.ts';

export interface SheetSelection {
  sheet: SheetInfo;
  sheets: SheetInfo[];
  meta: WorkbookMeta;
}

/** Pick the sheet to parse: explicit selection, else first visible sheet. */
export function selectSheet(sheets: SheetInfo[], options: ParseOptions, limits: IngestLimits): SheetInfo {
  const visible = sheets.filter((s) => s.visibility === 'visible');
  if (visible.length > limits.visibleSheets) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'xlsx.visible-sheets' });
  }
  if (options.selectedSheetId !== undefined) {
    const found = sheets.find((s) => s.sheetId === options.selectedSheetId);
    if (!found) {
      throw new IngestError('INVALID_FILE', { detail: 'xlsx.sheet-not-found' });
    }
    if (found.visibility !== 'visible' && !options.allowHiddenSheet) {
      throw new IngestError('UNSUPPORTED', { detail: 'xlsx.sheet-hidden-requires-opt-in' });
    }
    return found;
  }
  if (visible.length === 0) {
    throw new IngestError('UNSUPPORTED', { detail: 'xlsx.no-visible-sheets' });
  }
  return visible[0] as SheetInfo;
}

const MAX_SERIAL = 2958465 + 1462; // 1900-system 9999-12-31 plus the 1904 epoch offset

function isInvalidDateSerial(v: number, dateSystem: '1900' | '1904'): boolean {
  return v < 0 || v > MAX_SERIAL || (dateSystem === '1900' && v === 60);
}

interface EmissionBounds {
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}

/** Content bounds of dense `!data`, restricted to rows at/after `firstRow`. */
function contentBounds(
  data: readonly (readonly unknown[] | undefined)[],
  firstRow: number, // 1-based
): { lastRow: number; firstColumn: number; lastColumn: number } | null {
  let lastRow = 0;
  let firstColumn = Infinity;
  let lastColumn = -1;
  for (let r = firstRow; r <= data.length; r += 1) {
    const row = data[r - 1];
    if (!row) continue;
    let rowHasCell = false;
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (cell === undefined || cell === null) continue;
      rowHasCell = true;
      const col = c + 1;
      if (col < firstColumn) firstColumn = col;
      if (col > lastColumn) lastColumn = col;
    }
    if (rowHasCell) lastRow = r;
  }
  if (lastRow === 0) return null;
  return { lastRow, firstColumn, lastColumn };
}

function mapCell(
  cell: XLSX.CellObject,
  row: number,
  column: number,
  dateSystem: '1900' | '1904',
  warnings: Set<string>,
  limits: IngestLimits,
): RawCell {
  const base = { row, column };
  const assertLen = (s: string): string => {
    if (s.length > limits.cellCharacters) {
      throw new IngestError('LIMIT_EXCEEDED', { detail: 'cell.characters' });
    }
    return s;
  };

  // Formula text wins over the cached result — the cell IS the formula.
  if (typeof cell.f === 'string' && cell.f.length > 0) {
    warnings.add(WARNINGS.formulaCellsPresent);
    const text = `=${cell.f}`;
    return {
      ...base,
      raw: assertLen(text),
      type: 'formula',
      formula: assertLen(text),
      cachedValue: cell.w !== undefined ? assertLen(String(cell.w)) : serializeCached(cell.v),
    };
  }
  switch (cell.t) {
    case 'b':
      return { ...base, raw: cell.v === true, type: 'boolean', formula: null, cachedValue: null };
    case 'n': {
      const v = typeof cell.v === 'number' ? cell.v : Number.NaN;
      const serial = serializeNumber(v);
      if (typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) {
        if (serial === null || isInvalidDateSerial(v, dateSystem)) {
          warnings.add(WARNINGS.invalidDateSerial);
        }
        return { ...base, raw: serial, type: 'date', formula: null, cachedValue: null };
      }
      return { ...base, raw: serial, type: 'number', formula: null, cachedValue: null };
    }
    case 'e':
      return { ...base, raw: assertLen(String(cell.w ?? `#${String(cell.v)}`)), type: 'error', formula: null, cachedValue: null };
    case 'd': {
      const iso = serializeCached(cell.v);
      if (iso === null) warnings.add(WARNINGS.invalidDateSerial);
      return { ...base, raw: iso, type: 'date', formula: null, cachedValue: null };
    }
    case 's': {
      const v = cell.v === undefined || cell.v === null ? '' : String(cell.v);
      if (v === '') {
        return { ...base, raw: null, type: 'blank', formula: null, cachedValue: null };
      }
      return { ...base, raw: assertLen(v), type: 'text', formula: null, cachedValue: null };
    }
    default:
      // 'z' stubs are blank; a stray 'str'/unknown-typed cell still keeps its text.
      if (typeof cell.v === 'string' && cell.v !== '') {
        return { ...base, raw: assertLen(cell.v), type: 'text', formula: null, cachedValue: null };
      }
      return { ...base, raw: null, type: 'blank', formula: null, cachedValue: null };
  }
}

/**
 * Emit bounded RawCells from a dense worksheet for one row band.
 * `blankInHeader`: emit explicit blank cells for missing positions in the
 * header row (positional stability for duplicate/blank header handling).
 */
export function emitCells(
  ws: XLSX.WorkSheet,
  bounds: EmissionBounds,
  headerRow: number,
  dateSystem: '1900' | '1904',
  warnings: Set<string>,
  limits: IngestLimits,
): { cells: RawCell[]; nonemptyCount: number } {
  const data = ws['!data'] as readonly (readonly XLSX.CellObject[] | undefined)[] | undefined;
  const cells: RawCell[] = [];
  let nonempty = 0;

  for (let r = bounds.firstRow; r <= bounds.lastRow; r += 1) {
    const row = data?.[r - 1];
    const inHeader = r === headerRow;
    for (let c = bounds.firstColumn; c <= bounds.lastColumn; c += 1) {
      const cell = row?.[c - 1];
      if (cell === undefined || cell === null) {
        if (inHeader) {
          cells.push({ row: r, column: c, raw: null, type: 'blank', formula: null, cachedValue: null });
        }
        continue;
      }
      const mapped = mapCell(cell, r, c, dateSystem, warnings, limits);
      if (inHeader && mapped.type !== 'blank' && (mapped.raw === null || mapped.raw === '')) {
        cells.push({ ...mapped, type: 'blank' });
        continue;
      }
      if (mapped.type !== 'blank') {
        nonempty += 1;
        if (nonempty > limits.nonemptyCells) {
          throw new IngestError('LIMIT_EXCEEDED', { detail: 'nonempty-cells' });
        }
      }
      cells.push(mapped);
    }
  }
  return { cells, nonemptyCount: nonempty };
}

/** Merged ranges intersecting the selection → disclosure warning (SheetJS does read !merges). */
function mergedCellsWarning(ws: XLSX.WorkSheet, bounds: EmissionBounds, warnings: Set<string>): void {
  const merges = ws['!merges'] as XLSX.Range[] | undefined;
  if (!merges) return;
  for (const m of merges) {
    const mFirstRow = m.s.r + 1;
    const mLastRow = m.e.r + 1;
    const mFirstCol = m.s.c + 1;
    const mLastCol = m.e.c + 1;
    if (
      mFirstRow <= bounds.lastRow &&
      mLastRow >= bounds.firstRow &&
      mFirstCol <= bounds.lastColumn &&
      mLastCol >= bounds.firstColumn
    ) {
      warnings.add(WARNINGS.mergedCellsInRange);
      return;
    }
  }
}

/** Read (and bounded-parse) the selected sheet from a sanitized package. */
export function readSheet(workbookBytes: Uint8Array, sheetName: string): XLSX.WorkSheet {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(workbookBytes, {
      type: 'array',
      dense: true,
      cellNF: true,
      cellText: true,
      cellFormula: true,
      sheets: [sheetName],
    });
  } catch {
    throw new IngestError('INVALID_FILE', { detail: 'xlsx.parse-failed' });
  }
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new IngestError('INVALID_FILE', { detail: 'xlsx.sheet-part-missing' });
  }
  return ws;
}

/** Number of materialized cells in a dense row. */
function rowWidth(row: readonly unknown[] | undefined): number {
  if (!row) return 0;
  let w = 0;
  for (const c of row) if (c !== undefined && c !== null) w += 1;
  return w;
}

/**
 * Default header row: the first nonempty row whose width equals the modal
 * width of the first `previewRows` nonempty rows. A narrow title/preamble row
 * above the real header is skipped; when every row has the same width this is
 * simply the first nonempty row. UI can always override via options.headerRow.
 */
export function modalHeaderRow(
  data: readonly (readonly unknown[] | undefined)[],
  firstContentRow: number,
  limits: IngestLimits,
): number {
  const widths = new Map<number, number[]>(); // width -> first row index with it
  let scanned = 0;
  const candidates: { row: number; width: number }[] = [];
  for (let r = firstContentRow; r <= data.length && scanned < limits.previewRows; r += 1) {
    const w = rowWidth(data[r - 1]);
    if (w === 0) continue;
    scanned += 1;
    candidates.push({ row: r, width: w });
    if (!widths.has(w)) widths.set(w, []);
    (widths.get(w) as number[]).push(r);
  }
  if (candidates.length === 0) return firstContentRow;
  let modal = candidates[0] as { row: number; width: number };
  let modalCount = 0;
  for (const [w, rows] of widths) {
    if (rows.length > modalCount) {
      modalCount = rows.length;
      modal = { row: rows[0] as number, width: w };
    }
  }
  const first = candidates.find((c) => c.width === modal.width);
  return first ? first.row : firstContentRow;
}

/** Resolve effective emission bounds against the parsed sheet. */
function resolveBounds(
  ws: XLSX.WorkSheet,
  options: ParseOptions,
  limits: IngestLimits,
): EmissionBounds {
  const data = ws['!data'] as readonly (readonly XLSX.CellObject[] | undefined)[] | undefined;
  const rowCount = data?.length ?? 0;

  // First content row (any cell present) — default header candidate.
  let firstContent = 0;
  for (let r = 1; r <= rowCount; r += 1) {
    const row = data?.[r - 1];
    if (row && row.some((cell) => cell !== undefined && cell !== null)) {
      firstContent = r;
      break;
    }
  }
  if (firstContent === 0) {
    throw new IngestError('INVALID_FILE', { detail: 'xlsx.empty-sheet' });
  }

  const headerRow = options.headerRow ?? modalHeaderRow(data ?? [], firstContent, limits);
  if (!Number.isInteger(headerRow) || headerRow < 1) {
    throw new IngestError('INVALID_FILE', { detail: 'xlsx.header-row-invalid' });
  }

  const content = contentBounds(data ?? [], headerRow);
  if (!content || headerRow > content.lastRow) {
    throw new IngestError('INVALID_FILE', { detail: 'xlsx.header-row-beyond-content' });
  }

  const firstRow = headerRow;
  const lastRow = content.lastRow;
  const firstColumn = options.firstColumn ?? content.firstColumn;
  const lastColumn = options.lastColumn ?? content.lastColumn;
  if (!Number.isInteger(firstColumn) || !Number.isInteger(lastColumn) || firstColumn < 1 || firstColumn > lastColumn) {
    throw new IngestError('INVALID_FILE', { detail: 'xlsx.column-range-invalid' });
  }

  if (lastRow - firstRow + 1 > limits.rowsIncludingHeader) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'rows-including-header' });
  }
  if (lastColumn - firstColumn + 1 > limits.columns) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'columns' });
  }
  return { firstRow, lastRow, firstColumn, lastColumn };
}

export async function parseXlsx(
  bytes: Uint8Array,
  sourceName: string,
  options: ParseOptions,
  extras: IngestExtras,
  limits: IngestLimits,
  progress: Progress,
): Promise<RawTable> {
  checkAbort(extras.signal);
  const { sanitizedZip, entries } = await preflightZip(bytes, limits, extras.signal, (f) =>
    progress('preflight', f * 0.5),
  );
  checkAbort(extras.signal);
  const meta = readWorkbookMeta(entries, limits);
  const sheet = selectSheet(meta.sheets, options, limits);
  progress('preflight', 0.75);

  const ws = readSheet(sanitizedZip, sheet.name);
  progress('parse', 0.1);
  checkAbort(extras.signal);

  const bounds = resolveBounds(ws, options, limits);

  const warnings = new Set<string>();
  if (meta.hasExternalContent) warnings.add(WARNINGS.externalRefsIgnored);
  if (meta.sheets.some((s) => s.visibility !== 'visible')) warnings.add(WARNINGS.hiddenSheetsExcluded);
  if (sheet.visibility !== 'visible') warnings.add(WARNINGS.hiddenSheetSelected);
  if (meta.sheets.filter((s) => s.visibility === 'visible').length > 1) {
    warnings.add(WARNINGS.multiSheetWorkbook);
  }
  mergedCellsWarning(ws, bounds, warnings);

  // Sheet XML disclosures SheetJS never populates, plus formula-only cells
  // it drops entirely.
  const sheetPart = meta.sheetTargets.get(sheet.sheetId);
  const sheetXml = sheetPart ? entries.get(sheetPart) : undefined;
  const disclosure = sheetXml ? scanSheetXml(sheetXml, bounds) : null;
  if (disclosure?.hiddenRowsInRange) warnings.add(WARNINGS.hiddenRowsInRange);
  if (disclosure?.hiddenColsInRange) warnings.add(WARNINGS.hiddenColumnsInRange);

  const { cells } = emitCells(ws, bounds, bounds.firstRow, meta.dateSystem, warnings, limits);
  if (disclosure && disclosure.formulaOnlyCells.length > 0) {
    warnings.add(WARNINGS.formulaCellsPresent);
    const occupied = new Set(cells.map((c) => `${c.row}:${c.column}`));
    let extra = 0;
    for (const fc of disclosure.formulaOnlyCells) {
      const key = `${fc.row}:${fc.column}`;
      if (occupied.has(key)) continue;
      extra += 1;
      if (extra > limits.nonemptyCells) {
        throw new IngestError('LIMIT_EXCEEDED', { detail: 'nonempty-cells' });
      }
      const text = `=${fc.formula}`;
      if (text.length > limits.cellCharacters) {
        throw new IngestError('LIMIT_EXCEEDED', { detail: 'cell.characters' });
      }
      cells.push({ row: fc.row, column: fc.column, raw: text, type: 'formula', formula: text, cachedValue: null });
      occupied.add(key);
    }
  }
  for (let i = 0; i < cells.length; i += 1) {
    await yieldToEventLoop(i);
    checkAbort(extras.signal);
  }
  progress('parse', 0.9);

  const sourceHash = await sha256Hex(bytes.slice().buffer);
  const sheetId = sheet.sheetId;
  const sourceRef: SourceRef = {
    id: `src-${sourceHash.slice(0, 16)}-${sheetId}`,
    sourceHash,
    workbookName: sourceName,
    format: 'xlsx',
    sheetId,
    sheetName: sheet.name,
    headerRow: bounds.firstRow,
    range: {
      firstRow: bounds.firstRow,
      lastRow: bounds.lastRow,
      firstColumn: bounds.firstColumn,
      lastColumn: bounds.lastColumn,
    },
  };
  const table: RawTable = {
    id: `raw-${sourceHash.slice(0, 16)}-${sheetId}-r${bounds.firstRow}_${bounds.lastRow}-c${bounds.firstColumn}_${bounds.lastColumn}`,
    sourceRef,
    cells,
    dateSystem: meta.dateSystem,
    warnings: [...warnings],
  };

  const issues = checkRawTable(table);
  if (issues.length > 0) {
    throw new IngestError('INTERNAL', { detail: 'raw-table-contract-violation', recoverable: false });
  }
  progress('parse', 1);
  return table;
}
