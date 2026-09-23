/**
 * `inspectSource` — the bounded inspection the upload UI needs for its
 * sheet picker and preview. It reuses the exact same preflight + metadata
 * path as `parseSource` (INTERFACES.md: "a raw-sheet listing/preview uses
 * the same bounded preflight; never parse twice unbounded") and only parses
 * the sheet that would actually be selected, capped to `previewRows` cells.
 */
import type { RawCell } from '@rowfolio/contracts';
import { sha256Hex } from '@rowfolio/contracts';
import { detectFormat, decodeUtf8Fatal } from './detect.ts';
import { IngestError, isIngestError } from './errors.ts';
import { resolveLimits, type IngestLimits } from './limits.ts';
import { checkAbort } from './abort.ts';
import { preflightZip } from './zip-preflight.ts';
import { readWorkbookMeta } from './xlsx-meta.ts';
import { emitCells, readSheet, selectSheet } from './xlsx.ts';
import { detectDelimiter, parseCsvRecords, type CsvRecord } from './csv.ts';
import { serializeNumber } from './serialize.ts';
import type { IngestExtras, ParseOptions, Progress, SheetInfo, SourceInspection } from './types.ts';
import { WARNINGS } from './types.ts';

const noopProgress: Progress = () => {};

/** Preview cell map for CSV: record fields → RawCells (same rules as parse). */
function csvPreviewCells(record: CsvRecord, limits: IngestLimits): RawCell[] {
  const cells: RawCell[] = [];
  for (const [i, value] of record.fields.entries()) {
    const column = i + 1;
    if (value.length > limits.cellCharacters) {
      throw new IngestError('LIMIT_EXCEEDED', { detail: 'cell.characters' });
    }
    if (value === '') {
      cells.push({ row: record.startLine, column, raw: null, type: 'blank', formula: null, cachedValue: null });
    } else {
      cells.push({ row: record.startLine, column, raw: value, type: 'text', formula: null, cachedValue: null });
    }
  }
  return cells;
}

export async function inspectSource(
  bytes: ArrayBuffer,
  sourceName: string,
  options?: Partial<ParseOptions> & IngestExtras,
  progress: Progress = noopProgress,
): Promise<SourceInspection> {
  const opts: ParseOptions = {
    allowHiddenSheet: options?.allowHiddenSheet ?? false,
    ...(options?.headerRow !== undefined ? { headerRow: options.headerRow } : {}),
    ...(options?.firstColumn !== undefined ? { firstColumn: options.firstColumn } : {}),
    ...(options?.lastColumn !== undefined ? { lastColumn: options.lastColumn } : {}),
    ...(options?.selectedSheetId !== undefined ? { selectedSheetId: options.selectedSheetId } : {}),
  };
  const extras: IngestExtras = {
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
    ...(options?.delimiter !== undefined ? { delimiter: options.delimiter } : {}),
    ...(options?.limits !== undefined ? { limits: options.limits } : {}),
  };
  const limits: IngestLimits = resolveLimits(extras.limits);
  const input = new Uint8Array(bytes);

  checkAbort(extras.signal);
  progress('preflight', 0);
  if (input.byteLength > limits.compressedBytes) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'input-bytes' });
  }

  const format = detectFormat(input);
  const sourceHash = await sha256Hex(bytes.slice(0));

  if (format === 'csv') {
    let text = decodeUtf8Fatal(input, 'csv.invalid-utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (text.trim() === '') throw new IngestError('INVALID_FILE', { detail: 'csv.empty' });
    const delimiter = extras.delimiter ?? detectDelimiter(text, limits).delimiter;
    const { records } = parseCsvRecords(text, delimiter, limits, extras.signal, (f) =>
      progress('parse', f * 0.8),
    );
    const first = records[0];
    const last = records[records.length - 1];
    const maxFields = Math.max(...records.map((r) => r.fields.length));
    const previewRecords = records.slice(0, limits.previewRows);
    const previewCells = previewRecords.flatMap((r) => csvPreviewCells(r, limits));
    progress('parse', 1);
    const sheet: SheetInfo = {
      sheetId: 'S0',
      ordinal: 0,
      name: sourceName,
      visibility: 'visible',
      dimensions:
        first && last
          ? {
              firstRow: first.startLine,
              lastRow: last.endLine,
              firstColumn: 1,
              lastColumn: maxFields,
            }
          : null,
    };
    return {
      format,
      sourceName,
      sourceHash,
      compressedBytes: input.byteLength,
      sheets: [sheet],
      defaultSheetId: 'S0',
      hiddenSheets: [],
      dateSystem: 'not-applicable',
      previewRows: previewCells,
      previewRowNumbers: previewRecords.map((r) => r.startLine),
      warnings: [],
    };
  }

  // XLSX
  const { sanitizedZip, entries } = await preflightZip(input, limits, extras.signal, (f) =>
    progress('preflight', f * 0.5),
  );
  const meta = readWorkbookMeta(entries, limits);
  // An all-hidden workbook has no default sheet; inspection still returns the
  // sheet list so the UI can offer the explicit opt-in, with an empty preview.
  let sheet: SheetInfo | null = null;
  try {
    sheet = selectSheet(meta.sheets, opts, limits);
  } catch (e) {
    if (!isIngestError(e) || e.detail !== 'xlsx.no-visible-sheets') throw e;
  }
  progress('preflight', 0.75);

  const ws = sheet === null ? {} : readSheet(sanitizedZip, sheet.name);
  const data = ws['!data'] as readonly (readonly unknown[] | undefined)[] | undefined;

  // First content row → preview band start; cap at previewRows rows.
  let firstContent = 0;
  for (let r = 1; r <= (data?.length ?? 0); r += 1) {
    const row = data?.[r - 1];
    if (row && row.some((c) => c !== undefined && c !== null)) {
      firstContent = r;
      break;
    }
  }
  const preview: RawCell[] = [];
  const previewRowNumbers: number[] = [];
  if (firstContent > 0) {
    // Column bounds across the preview band.
    let fc = Infinity;
    let lc = 0;
    const bandEnd = Math.min(firstContent + limits.previewRows - 1, data?.length ?? 0);
    for (let r = firstContent; r <= bandEnd; r += 1) {
      const row = data?.[r - 1];
      if (!row) continue;
      for (let c = 0; c < row.length; c += 1) {
        if (row[c] !== undefined && row[c] !== null) {
          if (c + 1 < fc) fc = c + 1;
          if (c + 1 > lc) lc = c + 1;
        }
      }
    }
    if (lc > 0) {
      const warnings = new Set<string>();
      const { cells } = emitCells(
        ws,
        { firstRow: firstContent, lastRow: bandEnd, firstColumn: fc, lastColumn: lc },
        firstContent,
        meta.dateSystem,
        warnings,
        limits,
      );
      preview.push(...cells);
      const seen = new Set<number>();
      for (const cell of cells) if (!seen.has(cell.row)) seen.add(cell.row);
      previewRowNumbers.push(...seen);
    }
  }

  const warnings = new Set<string>();
  if (meta.hasExternalContent) warnings.add(WARNINGS.externalRefsIgnored);
  if (meta.sheets.some((s) => s.visibility !== 'visible')) warnings.add(WARNINGS.hiddenSheetsExcluded);
  if (meta.sheets.filter((s) => s.visibility === 'visible').length > 1) {
    warnings.add(WARNINGS.multiSheetWorkbook);
  }

  progress('parse', 1);
  return {
    format,
    sourceName,
    sourceHash,
    compressedBytes: input.byteLength,
    sheets: meta.sheets,
    defaultSheetId: sheet?.sheetId ?? null,
    hiddenSheets: meta.sheets.filter((s) => s.visibility !== 'visible'),
    dateSystem: meta.dateSystem,
    previewRows: preview,
    previewRowNumbers,
    warnings: [...warnings],
  };
}

/** Re-export for the sheet-picker label: serial stays raw; UI formats it. */
export { serializeNumber };
