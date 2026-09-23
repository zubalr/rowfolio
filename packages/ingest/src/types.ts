/**
 * Public ingest types beyond the contract's RawTable: format detection,
 * sheet inspection for the sheet-picker UI, and caller extras (cancellation,
 * CSV delimiter override, limit tuning for tests). Everything here is a
 * plain data structure — no library objects cross the package boundary.
 */
import type { RawCell } from '@rowfolio/contracts';
import type { IngestLimits } from './limits.ts';

/**
 * Structural twins of the declaration-only signature types in
 * packages/contracts/src/interfaces.ts. That module is not re-exported by
 * the contracts package index (boundary rules forbid deep imports), so the
 * identical shapes are declared here; tests assert assignability against the
 * contract source.
 */
export interface ParseOptions {
  selectedSheetId?: string;
  headerRow?: number;
  firstColumn?: number;
  lastColumn?: number;
  allowHiddenSheet: boolean;
}

/** Stage progress callback; fraction is null when the amount of work is unknown. */
export type Progress = (stage: string, fraction: number | null) => void;

/** Binary payloads carried next to a validated message — keyed by slot name. */
export type BinarySlots = ReadonlyMap<string, ArrayBuffer>;

export type SourceFormat = 'xlsx' | 'csv';

export type SheetVisibility = 'visible' | 'hidden' | 'very-hidden';

export interface SheetInfo {
  /** Stable sheet identifier `S{ordinal}` (0-based workbook order). */
  sheetId: string;
  /** 0-based position in workbook sheet order. */
  ordinal: number;
  name: string;
  visibility: SheetVisibility;
  /** Declared used-range bounds (1-based) when known; null when undeclared. */
  dimensions: { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number } | null;
}

/**
 * Bounded inspection result — enough for the upload UI's sheet picker and
 * preview without a second unbounded parse (INTERFACES.md: preview reuses
 * the same bounded preflight).
 */
export interface SourceInspection {
  format: SourceFormat;
  sourceName: string;
  sourceHash: string;
  compressedBytes: number;
  sheets: SheetInfo[];
  /** Sheet the parser will select when options.selectedSheetId is absent. */
  defaultSheetId: string | null;
  /** Hidden/very-hidden sheets, disclosed for the manual opt-in flow. */
  hiddenSheets: SheetInfo[];
  /** Declared date system (workbookPr date1904); 'not-applicable' for CSV. */
  dateSystem: '1900' | '1904' | 'not-applicable';
  /**
   * Up to `previewRows` rows of raw cells from the default (or selected)
   * sheet starting at its first used row — the bounded parsing preview.
   * Physical coordinates only; no semantics inferred.
   */
  previewRows: RawCell[];
  /** Physical row of each preview record's first cell, for header candidates. */
  previewRowNumbers: number[];
  /** Content-bearing content the ingestion ignores (see Warnings). */
  warnings: string[];
}

/** Caller extras layered on the contract `ParseOptions`. */
export interface IngestExtras {
  /** Cooperative cancellation — checked at every chunk boundary. */
  signal?: AbortSignal;
  /** CSV delimiter override; required when detection is ambiguous. */
  delimiter?: ',' | '\t' | ';';
  /** Limit overrides (tests/diagnostics). Do not relax in production. */
  limits?: Partial<IngestLimits>;
}

/** Stable warning codes emitted on RawTable.warnings / SourceInspection.warnings. */
export const WARNINGS = {
  mergedCellsInRange: 'ingest.warn.merged-cells-in-range',
  hiddenRowsInRange: 'ingest.warn.hidden-rows-in-range',
  hiddenColumnsInRange: 'ingest.warn.hidden-columns-in-range',
  invalidDateSerial: 'ingest.warn.invalid-date-serial',
  externalRefsIgnored: 'ingest.warn.external-refs-ignored',
  formulaCellsPresent: 'ingest.warn.formula-cells',
  hiddenSheetsExcluded: 'ingest.warn.hidden-sheets-excluded',
  hiddenSheetSelected: 'ingest.warn.hidden-sheet-selected',
  multiSheetWorkbook: 'ingest.warn.multi-sheet-workbook',
  csvRaggedRows: 'ingest.warn.csv-ragged-rows',
  csvBlankRecordsSkipped: 'ingest.warn.csv-blank-records-skipped',
} as const;
