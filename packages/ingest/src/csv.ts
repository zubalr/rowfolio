/**
 * CSV adapter: UTF-8-fatal decode, deterministic delimiter detection among
 * comma/tab/semicolon, then a Papa Parse step-stream that preserves physical
 * line coordinates.
 *
 * Provenance contract: a RawCell's `row` is the 1-based physical line where
 * its record STARTS; a record's end line is derivable from the next record's
 * start line (or the range end). Quoted newlines therefore produce sparse
 * row coordinates — identical to hidden/empty rows in XLSX. All values are
 * text; empty fields are 'blank' cells; absent fields (ragged rows) emit
 * nothing. No type coercion — "007" stays text.
 */
import Papa from 'papaparse';
import type { RawCell, RawTable, SourceRef } from '@rowfolio/contracts';
import { checkRawTable, sha256Hex } from '@rowfolio/contracts';
import { IngestError } from './errors.ts';
import type { IngestLimits } from './limits.ts';
import { checkAbort, yieldToEventLoop } from './abort.ts';
import { decodeUtf8Fatal } from './detect.ts';
import type { IngestExtras, ParseOptions, Progress } from './types.ts';
import { WARNINGS } from './types.ts';

export const CSV_DELIMITERS = [',', '\t', ';'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

export interface CsvRecord {
  /** Field texts in order. */
  fields: string[];
  /** 1-based physical line where the record starts. */
  startLine: number;
  /** 1-based physical line where the record ends. */
  endLine: number;
}

/**
 * Character offset → 1-based line number via a precomputed newline index.
 * A line break is '\n', or '\r' when not followed by '\n' (lone-CR files).
 */
function makeLineIndex(text: string): (offset: number) => number {
  const breaks: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 10) breaks.push(i);
    else if (c === 13 && text.charCodeAt(i + 1) !== 10) breaks.push(i);
  }
  return (offset: number) => {
    // first break at position >= offset → line = its index + 1
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((breaks[mid] as number) >= offset) hi = mid;
      else lo = mid + 1;
    }
    return lo + 1;
  };
}

/**
 * Detect the delimiter: the one producing consistent field width on every
 * non-empty sampled record wins. Multiple consistent candidates →
 * AMBIGUOUS_INPUT so the UI asks rather than guesses (spec 15).
 */
export function detectDelimiter(
  text: string,
  limits: IngestLimits,
): { delimiter: CsvDelimiter; candidates: CsvDelimiter[] } {
  const sample = text.slice(0, limits.csvSampleBytes);
  const consistent: CsvDelimiter[] = [];
  const partial: CsvDelimiter[] = [];

  for (const d of CSV_DELIMITERS) {
    const res = Papa.parse<string[]>(sample, {
      delimiter: d,
      skipEmptyLines: 'greedy',
      preview: 0,
    });
    const rows = res.data.filter((r) => !(r.length === 1 && r[0] === ''));
    if (rows.length === 0) continue;
    const width = rows[0]?.length ?? 0;
    const uniform = width > 1 && rows.every((r) => r.length === width);
    if (uniform) consistent.push(d);
    else if (rows.some((r) => r.length > 1)) partial.push(d);
  }

  if (consistent.length > 1 || partial.length > 1) {
    throw new IngestError('AMBIGUOUS_INPUT', { detail: 'csv.ambiguous-delimiter' });
  }
  if (consistent.length === 1) {
    return { delimiter: consistent[0] as CsvDelimiter, candidates: consistent };
  }
  if (partial.length === 1) {
    return { delimiter: partial[0] as CsvDelimiter, candidates: partial };
  }
  // Single-column file (or empty): comma is the deterministic default.
  return { delimiter: ',', candidates: [','] };
}

/**
 * Stream the CSV text into records with physical line spans. Papa's `step`
 * exposes `meta.cursor` = the offset just after the record terminator, so a
 * record's start offset is found by skipping blank-line whitespace between
 * the previous cursor and this record's content.
 */
export function parseCsvRecords(
  text: string,
  delimiter: CsvDelimiter,
  limits: IngestLimits,
  signal: AbortSignal | undefined,
  progress: (fraction: number) => void,
): { records: CsvRecord[]; skippedBlankLines: boolean } {
  const lineAt = makeLineIndex(text);
  const records: CsvRecord[] = [];
  let prevCursor = 0;
  let skippedBlankLines = false;

  Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: 'greedy',
    step: (row) => {
      checkAbort(signal);
      const end = row.meta.cursor;
      let start = prevCursor;
      while (start < end && isBlankGapChar(text.charCodeAt(start))) start += 1;
      if (start > prevCursor) skippedBlankLines = true;
      records.push({
        fields: row.data,
        startLine: lineAt(start),
        endLine: lineAt(Math.max(end - 1, start)),
      });
      prevCursor = end;
      progress(Math.min(end / Math.max(text.length, 1), 1));
    },
  });

  if (records.length === 0) {
    throw new IngestError('INVALID_FILE', { detail: 'csv.no-records' });
  }
  return { records, skippedBlankLines };
}

function isBlankGapChar(code: number): boolean {
  return code === 10 || code === 13 || code === 32 || code === 9;
}

/**
 * Default header record: the first record whose field count equals the modal
 * width of the first `previewRows` records — narrow title/comment lines above
 * the real header are skipped. Uniform files pick the first record.
 */
function modalHeaderRecord(records: readonly CsvRecord[], limits: IngestLimits): number {
  const sample = records.slice(0, limits.previewRows);
  const counts = new Map<number, number>();
  for (const r of sample) {
    counts.set(r.fields.length, (counts.get(r.fields.length) ?? 0) + 1);
  }
  let modalWidth = sample[0]?.fields.length ?? 0;
  let best = 0;
  for (const [w, c] of counts) {
    if (c > best) {
      best = c;
      modalWidth = w;
    }
  }
  const idx = records.findIndex((r) => r.fields.length === modalWidth);
  return idx < 0 ? 0 : idx;
}

export async function parseCsv(
  bytes: Uint8Array,
  sourceName: string,
  options: ParseOptions,
  extras: IngestExtras,
  limits: IngestLimits,
  progress: Progress,
): Promise<RawTable> {
  checkAbort(extras.signal);
  progress('preflight', 0);
  if (bytes.byteLength > limits.compressedBytes) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'input-bytes' });
  }
  let text = decodeUtf8Fatal(bytes, 'csv.invalid-utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.trim() === '') {
    throw new IngestError('INVALID_FILE', { detail: 'csv.empty' });
  }

  const delimiter = extras.delimiter ?? detectDelimiter(text, limits).delimiter;
  checkAbort(extras.signal);
  progress('preflight', 1);

  const { records, skippedBlankLines } = parseCsvRecords(text, delimiter, limits, extras.signal, (f) =>
    progress('parse', f * 0.8),
  );

  const warnings = new Set<string>();
  if (skippedBlankLines) warnings.add(WARNINGS.csvBlankRecordsSkipped);

  // headerRow is a physical line number and must land on a record start.
  let headerIndex: number;
  if (options.headerRow !== undefined) {
    const target = options.headerRow;
    const idx = records.findIndex((r) => r.startLine === target);
    if (idx < 0) {
      const insideRecord = records.some((r) => r.startLine < target && r.endLine >= target);
      throw new IngestError('INVALID_FILE', {
        detail: insideRecord ? 'csv.header-row-inside-record' : 'csv.header-row-not-a-record',
      });
    }
    headerIndex = idx;
  } else {
    headerIndex = modalHeaderRecord(records, limits);
  }

  const header = records[headerIndex] as CsvRecord;
  const tableRecords = records.slice(headerIndex);
  if (tableRecords.length > limits.rowsIncludingHeader) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'rows-including-header' });
  }

  const maxFields = Math.max(...tableRecords.map((r) => r.fields.length));
  const firstColumn = options.firstColumn ?? 1;
  const lastColumn = options.lastColumn ?? maxFields;
  if (
    !Number.isInteger(firstColumn) ||
    !Number.isInteger(lastColumn) ||
    firstColumn < 1 ||
    firstColumn > lastColumn
  ) {
    throw new IngestError('INVALID_FILE', { detail: 'csv.column-range-invalid' });
  }
  if (lastColumn - firstColumn + 1 > limits.columns) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'columns' });
  }
  if (tableRecords.slice(1).some((r) => r.fields.length !== header.fields.length)) {
    warnings.add(WARNINGS.csvRaggedRows);
  }

  const firstRow = header.startLine;
  const lastRecord = tableRecords[tableRecords.length - 1] as CsvRecord;
  const lastRow = lastRecord.endLine;

  // Selected-range volume cap: `nonemptyCells` bounds real content only, so a
  // mostly-empty range must be refused up front rather than materialize one
  // object (and downstream one quality issue) per blank position.
  if ((lastRow - firstRow + 1) * (lastColumn - firstColumn + 1) > limits.nonemptyCells) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'range-cells' });
  }

  const cells: RawCell[] = [];
  let nonempty = 0;
  for (const [i, rec] of tableRecords.entries()) {
    checkAbort(extras.signal);
    await yieldToEventLoop(i);
    const inHeader = rec === header;
    for (let c = firstColumn; c <= lastColumn; c += 1) {
      const value = c - 1 < rec.fields.length ? rec.fields[c - 1] : undefined;
      if (value === undefined) {
        // Ragged short row: absent cells emit nothing — except in the header,
        // where an explicit blank preserves positional field identity.
        if (inHeader) {
          cells.push({ row: rec.startLine, column: c, raw: null, type: 'blank', formula: null, cachedValue: null });
        }
        continue;
      }
      if (value.length > limits.cellCharacters) {
        throw new IngestError('LIMIT_EXCEEDED', { detail: 'cell.characters' });
      }
      if (value === '') {
        // Present-but-empty field: identical to an absent cell for every
        // consumer (cellAt → null text), so only the header keeps the
        // positional placeholder — sparse files must not materialize
        // one object per blank field.
        if (inHeader) {
          cells.push({ row: rec.startLine, column: c, raw: null, type: 'blank', formula: null, cachedValue: null });
        }
        continue;
      }
      nonempty += 1;
      if (nonempty > limits.nonemptyCells) {
        throw new IngestError('LIMIT_EXCEEDED', { detail: 'nonempty-cells' });
      }
      cells.push({ row: rec.startLine, column: c, raw: value, type: 'text', formula: null, cachedValue: null });
    }
  }

  const sourceHash = await sha256Hex(bytes.slice().buffer);
  const sheetId = 'S0';
  const sourceRef: SourceRef = {
    id: `src-${sourceHash.slice(0, 16)}-${sheetId}`,
    sourceHash,
    workbookName: sourceName,
    format: 'csv',
    sheetId,
    sheetName: sourceName,
    headerRow: firstRow,
    range: { firstRow, lastRow, firstColumn, lastColumn },
  };
  const table: RawTable = {
    id: `raw-${sourceHash.slice(0, 16)}-${sheetId}-r${firstRow}_${lastRow}-c${firstColumn}_${lastColumn}`,
    sourceRef,
    cells,
    dateSystem: 'not-applicable',
    warnings: [...warnings],
  };

  const issues = checkRawTable(table);
  if (issues.length > 0) {
    throw new IngestError('INTERNAL', { detail: 'raw-table-contract-violation', recoverable: false });
  }
  progress('parse', 1);
  return table;
}
