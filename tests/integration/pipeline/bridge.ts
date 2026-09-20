/**
 * Test-only bridge from raw bytes to `RawTable`.
 *
 * This is NOT production ingestion (that lane owns the bounded worker
 * parser, date-system handling and hostile-archive guards). It exists so
 * the pipeline harness can feed real CSV/XLSX bytes into the owned
 * normalize → analysis → … → export path with explicit, documented
 * bounds. Every limit mirrors the contract policy; violations throw
 * typed errors instead of truncating.
 *
 * Deliberate simplifications (all asserted or documented in tests):
 * - CSV: UTF-8 (BOM stripped), comma delimiter, quoted fields, CRLF.
 * - XLSX: read through the frozen ExcelJS dependency; numbers pass
 *   through as JS doubles formatted back to strings, ISO date strings
 *   stay strings, booleans stay booleans, blanks become null, formula
 *   cells keep `{ formula, cachedValue }`. Excel date *serials* are out
 *   of scope here (1900/1904 systems belong to the ingest lane).
 */
import type { RawCell, RawTable } from '../../../packages/contracts/src/index.ts';

export class BridgeError extends Error {
  readonly code: 'limit-exceeded' | 'empty-input' | 'unsupported-cell';
  constructor(code: BridgeError['code'], message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

export const BRIDGE_MAX_ROWS = 50000;
export const BRIDGE_MAX_COLUMNS = 100;
export const BRIDGE_MAX_CELL_CHARS = 32000;
export const BRIDGE_MAX_NONEMPTY_CELLS = 500000;

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushField();
      rows.push(row);
      row = [];
    } else if (ch === '\r') {
      // CRLF: swallow the carriage return.
    } else {
      field += ch;
    }
  }
  pushField();
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

export interface CsvBridgeOptions {
  readonly sourceName: string;
  readonly sourceHash: string;
}

export function rawFromCsvBytes(bytes: Uint8Array, options: CsvBridgeOptions): RawTable {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  const lines = parseCsvText(text).filter((r) => !(r.length === 1 && r[0]?.trim() === ''));
  if (lines.length === 0) throw new BridgeError('empty-input', 'CSV has no rows');
  const width = Math.max(...lines.map((l) => l.length));
  if (lines.length > BRIDGE_MAX_ROWS) {
    throw new BridgeError('limit-exceeded', `CSV rows ${lines.length} exceed ${BRIDGE_MAX_ROWS}`);
  }
  if (width > BRIDGE_MAX_COLUMNS) {
    throw new BridgeError('limit-exceeded', `CSV columns ${width} exceed ${BRIDGE_MAX_COLUMNS}`);
  }
  const cells: RawCell[] = [];
  let nonempty = 0;
  lines.forEach((line, r) => {
    for (let c = 0; c < width; c += 1) {
      const value = line[c] ?? '';
      if (value.length > BRIDGE_MAX_CELL_CHARS) {
        throw new BridgeError('limit-exceeded', `cell (${r + 1},${c + 1}) exceeds ${BRIDGE_MAX_CELL_CHARS} chars`);
      }
      if (value !== '') nonempty += 1;
      if (nonempty > BRIDGE_MAX_NONEMPTY_CELLS) {
        throw new BridgeError('limit-exceeded', `nonempty cells exceed ${BRIDGE_MAX_NONEMPTY_CELLS}`);
      }
      cells.push({ row: r + 1, column: c + 1, raw: value, type: 'text', formula: null, cachedValue: null });
    }
  });
  return {
    id: 'raw-bridge-csv',
    sourceRef: {
      id: 'source-bridge',
      sourceHash: options.sourceHash,
      workbookName: options.sourceName,
      format: 'csv',
      sheetId: 'S0',
      sheetName: 'csv',
      headerRow: 1,
      range: { firstRow: 1, lastRow: lines.length, firstColumn: 1, lastColumn: width },
    },
    cells,
    dateSystem: 'not-applicable',
    warnings: [],
  };
}

export interface XlsxBridgeOptions {
  readonly sourceName: string;
  readonly sourceHash: string;
  readonly sheetName: string;
}

type ExcelCellValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | { readonly formula: string; readonly result?: string | number | boolean | null };

interface ExcelWorksheetLike {
  readonly rowCount: number;
  readonly columnCount: number;
  getRow(n: number): { values: ExcelCellValue[] };
}

interface ExcelWorkbookLike {
  getWorksheet(name: string): ExcelWorksheetLike | undefined;
  readonly worksheets: ExcelWorksheetLike[];
}

/** Map one ExcelJS-decoded cell to a raw cell (bounds enforced). */
function toRawCell(value: ExcelCellValue, row: number, column: number): RawCell {
  if (value === null || value === undefined || value === '') {
    return { row, column, raw: null, type: 'blank', formula: null, cachedValue: null };
  }
  if (typeof value === 'boolean') {
    return { row, column, raw: value, type: 'boolean', formula: null, cachedValue: null };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new BridgeError('unsupported-cell', `non-finite number at (${row},${column})`);
    }
    return { row, column, raw: String(value), type: 'number', formula: null, cachedValue: null };
  }
  if (value instanceof Date) {
    // UTC date-only rendering; serial systems stay with the ingest lane.
    const iso = value.toISOString().slice(0, 10);
    return { row, column, raw: iso, type: 'date', formula: null, cachedValue: null };
  }
  if (typeof value === 'object') {
    const cached = value.result === null || value.result === undefined ? null : String(value.result);
    return { row, column, raw: value.formula, type: 'formula', formula: value.formula, cachedValue: cached };
  }
  if (value.length > BRIDGE_MAX_CELL_CHARS) {
    throw new BridgeError('limit-exceeded', `cell (${row},${column}) exceeds ${BRIDGE_MAX_CELL_CHARS} chars`);
  }
  return { row, column, raw: value, type: 'text', formula: null, cachedValue: null };
}

export async function rawFromXlsxWorkbook(
  workbook: ExcelWorkbookLike,
  options: XlsxBridgeOptions,
): Promise<RawTable> {
  const sheet = workbook.getWorksheet(options.sheetName) ?? workbook.worksheets[0];
  if (sheet === undefined) throw new BridgeError('empty-input', 'XLSX has no worksheets');
  if (sheet.rowCount > BRIDGE_MAX_ROWS) {
    throw new BridgeError('limit-exceeded', `XLSX rows ${sheet.rowCount} exceed ${BRIDGE_MAX_ROWS}`);
  }
  if (sheet.columnCount > BRIDGE_MAX_COLUMNS) {
    throw new BridgeError('limit-exceeded', `XLSX columns ${sheet.columnCount} exceed ${BRIDGE_MAX_COLUMNS}`);
  }
  const cells: RawCell[] = [];
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    const values = sheet.getRow(r).values;
    for (let c = 1; c <= sheet.columnCount; c += 1) {
      cells.push(toRawCell(values[c], r, c));
    }
  }
  return {
    id: 'raw-bridge-xlsx',
    sourceRef: {
      id: 'source-bridge',
      sourceHash: options.sourceHash,
      workbookName: options.sourceName,
      format: 'xlsx',
      sheetId: 'S0',
      sheetName: options.sheetName,
      headerRow: 1,
      range: { firstRow: 1, lastRow: sheet.rowCount, firstColumn: 1, lastColumn: sheet.columnCount },
    },
    cells,
    dateSystem: '1900',
    warnings: [],
  };
}
