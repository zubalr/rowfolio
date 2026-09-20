/**
 * Conservative table profiler: proposes columns and quality actions,
 * changes nothing. All suggestions carry `confirmed: false` / `proposed`
 * status — a manifest or user approval plan promotes them in `normalize.ts`.
 *
 * Issue ID scheme (stable, deterministic): `quality-<kind>-<sourceRow>` with
 * a `-c<sourceColumn>` suffix only when a row needs more than one issue of
 * the same kind. The sample ledger needs no suffixes, so its IDs match the
 * checked-in quality ledger exactly.
 */
import { POLICY } from '@rowfolio/contracts';
import type {
  CellValue,
  Column,
  QualityIssue,
  RawCell,
  RawTable,
  Unit,
} from '@rowfolio/contracts';

const MAX_SAMPLE_CELLS = 2000;
const NUMERIC_FRACTION = Number(POLICY.thresholds.numericInferenceFraction);
const DATE_FRACTION = Number(POLICY.thresholds.dateInferenceFraction);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH_DATE = /^\d{1,2}\/\d{1,2}\/(\d{2}|\d{4})$/;
const DECIMAL_TEXT = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const LEADING_ZERO_NUMERIC = /^-?0[0-9]/;
const ARABIC_INDIC = /[٠-٩۰-۹]/;

export function columnLetter(index1: number): string {
  let n = index1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function slugColumnId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug === '' ? 'column' : slug;
}

export function foldKey(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

export function significantDigitsOf(text: string): number {
  const digits = text.replace(/[^0-9]/g, '').replace(/^0+/, '');
  return Math.max(1, digits.length);
}

export interface HeaderCell {
  readonly column: number;
  readonly label: string;
  readonly blank: boolean;
}

/** O(1) cell lookup; profilers must never scan the cell array per coordinate. */
export type CellIndex = ReadonlyMap<string, RawCell>;

export function indexCells(raw: RawTable): CellIndex {
  const map = new Map<string, RawCell>();
  for (const cell of raw.cells) map.set(`${cell.row}:${cell.column}`, cell);
  return map;
}

export function cellAt(index: CellIndex, row: number, column: number): RawCell | undefined {
  return index.get(`${row}:${column}`);
}

export function readHeaders(raw: RawTable, index?: CellIndex): HeaderCell[] {
  const { firstColumn, lastColumn } = raw.sourceRef.range;
  const out: HeaderCell[] = [];
  for (let c = firstColumn; c <= lastColumn; c += 1) {
    const cell = index !== undefined ? cellAt(index, raw.sourceRef.headerRow, c)
      : raw.cells.find((x) => x.row === raw.sourceRef.headerRow && x.column === c);
    const text = typeof cell?.raw === 'string' ? cell.raw : '';
    const blank = text.trim() === '';
    out.push({ column: c, label: blank ? `Column ${columnLetter(c)}` : text, blank });
  }
  return out;
}

export function dataRows(raw: RawTable): number[] {
  const { firstRow, lastRow } = raw.sourceRef.range;
  const rows: number[] = [];
  for (let r = Math.max(firstRow, raw.sourceRef.headerRow + 1); r <= lastRow; r += 1) rows.push(r);
  return rows;
}

export function cellText(cell: RawCell | undefined): string | null {
  if (cell === undefined || cell.raw === null) return null;
  if (typeof cell.raw === 'boolean') return cell.raw ? 'TRUE' : 'FALSE';
  return cell.raw;
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export interface ColumnSample {
  readonly values: string[];
}

export function sampleColumn(raw: RawTable, column: number, rows: number[], index?: CellIndex): ColumnSample {
  const nonempty: string[] = [];
  for (const r of rows) {
    const cell = index !== undefined ? cellAt(index, r, column)
      : raw.cells.find((x) => x.row === r && x.column === column);
    const text = cellText(cell);
    if (text !== null && text !== '') nonempty.push(text);
  }
  if (nonempty.length <= MAX_SAMPLE_CELLS) return { values: nonempty };
  const step = nonempty.length / MAX_SAMPLE_CELLS;
  const values: string[] = [];
  for (let i = 0; i < MAX_SAMPLE_CELLS; i += 1) {
    values.push(nonempty[Math.floor(i * step)] as string);
  }
  return { values };
}

function voteType(texts: string[]): Column['type'] {
  if (texts.length === 0) return 'text';
  let numericOk = 0;
  let dateOk = 0;
  let boolOk = 0;
  let leadingZero = false;
  for (const rawText of texts) {
    const text = rawText.trim();
    if (LEADING_ZERO_NUMERIC.test(text)) leadingZero = true;
    if (DECIMAL_TEXT.test(text) && !ARABIC_INDIC.test(text)) numericOk += 1;
    const iso = ISO_DATE.exec(text);
    if (iso !== null && isRealDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))) dateOk += 1;
    if (/^(true|false|yes|no|نعم|لا)$/i.test(text)) boolOk += 1;
  }
  if (leadingZero && numericOk / texts.length >= NUMERIC_FRACTION) return 'identifier';
  if (dateOk / texts.length >= DATE_FRACTION) return 'date';
  if (numericOk / texts.length >= NUMERIC_FRACTION && !leadingZero) {
    return texts.some((v) => v.trim().includes('.')) ? 'decimal' : 'integer';
  }
  if (boolOk / texts.length >= NUMERIC_FRACTION) return 'boolean';
  if (numericOk / texts.length > 0.5) return 'mixed';
  return 'text';
}

const ID_NAME = /(^|_)(id|key|code|site)$/i;

function proposeRole(label: string, type: Column['type']): Column['role'] {
  if (type === 'date') return 'date';
  if (type === 'identifier' || ID_NAME.test(label)) return 'identifier';
  if (type === 'integer' || type === 'decimal') return 'measure';
  if (type === 'text') return 'dimension';
  return 'unknown';
}

const UNKNOWN_UNIT: Unit = { kind: 'unknown', label: 'unit', currency: null };

export interface ProfileResult {
  readonly proposedColumns: Column[];
  readonly issues: QualityIssue[];
}

function makeIssue(
  id: string,
  kind: QualityIssue['kind'],
  raw: RawTable,
  sourceRow: number,
  fieldId: string | null,
  original: string | null,
  normalized: string | null,
  action: QualityIssue['action'],
  messageKey: string,
  canonicalSourceRow: number | null = null,
): QualityIssue {
  return {
    id, kind, sourceRefId: raw.sourceRef.id, sourceRow, fieldId,
    original, normalized, status: 'proposed', action, approval: 'none',
    canonicalSourceRow, messageKey,
  };
}

export function profileTable(raw: RawTable): ProfileResult {
  const issues: QualityIssue[] = [];
  const index = indexCells(raw);
  const headers = readHeaders(raw, index);
  const rows = dataRows(raw);

  const seenSlugs = new Map<string, number>();
  const columns: Column[] = headers.map((header) => {
    const base = slugColumnId(header.label);
    const ordinal = (seenSlugs.get(base) ?? 0) + 1;
    seenSlugs.set(base, ordinal);
    const id = ordinal === 1 ? base : `${base}__${ordinal}`;
    const sample = sampleColumn(raw, header.column, rows, index);
    const type = voteType(sample.values);
    return {
      id,
      sourceColumn: header.column,
      label: header.label,
      type,
      role: proposeRole(header.label, type),
      unit: UNKNOWN_UNIT,
      additive: false,
      confirmed: false,
      nullable: true,
    };
  });
  const byColumn = new Map(columns.map((c) => [c.sourceColumn, c] as const));

  for (const header of headers) {
    if (!header.blank) continue;
    issues.push(makeIssue(
      `quality-header-${header.column}`, 'header', raw, raw.sourceRef.headerRow,
      byColumn.get(header.column)?.id ?? null, '', header.label, 'confirm-type', 'quality.proposed',
    ));
  }
  const labelSeen = new Map<string, string>();
  for (const header of headers) {
    if (header.blank) continue;
    const key = foldKey(header.label);
    const prior = labelSeen.get(key);
    if (prior !== undefined && prior !== header.label) {
      issues.push(makeIssue(
        `quality-header-ambiguous-${header.column}`, 'header', raw, raw.sourceRef.headerRow,
        byColumn.get(header.column)?.id ?? null, header.label, null, 'confirm-type', 'quality.proposed',
      ));
    } else if (prior === undefined) {
      labelSeen.set(key, header.label);
    }
  }

  const seenRows = new Map<string, number>();
  for (const r of rows) {
    const key = JSON.stringify(cellsKey(index, r, headers));
    const prior = seenRows.get(key);
    if (prior !== undefined) {
      // `original` carries the row's leading cell so the ledger names the
      // excluded copy (for the sample, the operation id).
      const lead = cellText(cellAt(index, r, headers[0]?.column ?? 1));
      issues.push(makeIssue(
        `quality-duplicate-${r}`, 'duplicate', raw, r, null, lead !== '' ? lead : null, null,
        'exclude-row', 'quality.duplicate', prior,
      ));
    } else {
      seenRows.set(key, r);
    }
  }

  const textColumns = columns.filter((c) => c.type === 'text' || c.type === 'mixed');
  for (const column of textColumns) {
    const canon = new Map<string, string>();
    for (const r of rows) {
      const text = cellText(cellAt(index, r, column.sourceColumn));
      if (text === null || text === '') continue;
      const key = foldKey(text);
      const first = canon.get(key);
      if (first === undefined) {
        canon.set(key, text);
      } else if (first !== text) {
        issues.push(makeIssue(
          `quality-category-${r}`, 'category', raw, r, column.id, text, first,
          'map-category', 'quality.category',
        ));
      }
    }
  }

  const missingByRow = new Map<number, Column[]>();
  for (const column of columns) {
    for (const r of rows) {
      const cell = cellAt(index, r, column.sourceColumn);
      const text = cellText(cell);
      if (text !== null && text !== '') continue;
      const list = missingByRow.get(r) ?? [];
      list.push(column);
      missingByRow.set(r, list);
    }
  }
  for (const [r, cols] of missingByRow) {
    cols.forEach((column, index) => {
      issues.push(makeIssue(
        index === 0 ? `quality-missing-${r}` : `quality-missing-${r}-c${column.sourceColumn}`,
        'missing', raw, r, column.id, null, null, 'none', 'quality.missing',
      ));
    });
  }

  for (const column of columns) {
    for (const r of rows) {
      const cell = cellAt(index, r, column.sourceColumn);
      const text = cellText(cell);
      if (text === null || text === '') continue;
      const trimmed = text.trim();
      if (cell?.type === 'formula') {
        issues.push(makeIssue(
          `quality-formula-${r}-c${column.sourceColumn}`, 'formula-cache', raw, r, column.id,
          cell.formula, cell.cachedValue, 'use-cache', 'quality.proposed',
        ));
      }
      if (SLASH_DATE.test(trimmed) && !ISO_DATE.test(trimmed)) {
        issues.push(makeIssue(
          `quality-date-${r}-c${column.sourceColumn}`, 'ambiguous-date', raw, r, column.id,
          text, null, 'confirm-type', 'upload.ambiguousDate',
        ));
      }
      if (DECIMAL_TEXT.test(trimmed)) {
        const limit = cell?.type === 'number'
          ? POLICY.numeric.excelNumericMaxSignificantDigits
          : POLICY.numeric.maxInputSignificantDigits;
        if (significantDigitsOf(trimmed) > limit) {
          issues.push(makeIssue(
            `quality-precision-${r}-c${column.sourceColumn}`, 'precision', raw, r, column.id,
            text, text, 'confirm-type', 'quality.proposed',
          ));
        }
      }
    }
  }
  return { proposedColumns: columns, issues };
}

function cellsKey(index: CellIndex, row: number, headers: HeaderCell[]): CellValue[] {
  return headers.map((h) => {
    const cell = cellAt(index, row, h.column);
    if (cell === undefined || cell.raw === null) return null;
    if (typeof cell.raw === 'boolean') return cell.raw;
    return cell.raw;
  });
}
