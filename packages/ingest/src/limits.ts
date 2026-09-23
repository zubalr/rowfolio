/**
 * Bounded-ingestion limits. Defaults come from POLICY.limits (contract
 * authority, v1.0.0); callers may tighten or relax individual values via
 * `IngestExtras.limits` (used by tests and diagnostics). Production callers
 * should never relax the defaults — the caps exist to keep the worker
 * responsive and bounded.
 */
import { POLICY } from '@rowfolio/contracts';

export interface IngestLimits {
  /** Max compressed input bytes (applies to CSV bytes too — input size cap). */
  compressedBytes: number;
  /** Max cumulative actually-decompressed bytes across all ZIP entries. */
  expandedBytes: number;
  /** Max actually-decompressed bytes for a single ZIP entry. */
  entryBytes: number;
  /** Max ZIP central-directory entries. */
  entries: number;
  /** Max cumulativeExpanded / compressedInput ratio. */
  expansionRatio: number;
  /** Max rows in the selected range including the header row (CSV: logical records). */
  rowsIncludingHeader: number;
  /** Max columns in the selected range. */
  columns: number;
  /** Max non-blank cells emitted. */
  nonemptyCells: number;
  /** Max visible sheets listed. */
  visibleSheets: number;
  /** Max characters in a single cell's raw text. */
  cellCharacters: number;
  /** Rows scanned for header-candidate preview (spec: first 30 nonempty rows). */
  previewRows: number;
  /** Bytes sampled for CSV delimiter detection. */
  csvSampleBytes: number;
  /** Bytes scanned at the top of a sheet XML part for its <dimension>. */
  dimensionScanBytes: number;
}

export function defaultLimits(): IngestLimits {
  const l = POLICY.limits;
  return {
    compressedBytes: l.compressedBytes,
    expandedBytes: l.expandedBytes,
    entryBytes: l.entryBytes,
    entries: l.entries,
    expansionRatio: l.expansionRatio,
    rowsIncludingHeader: l.rowsIncludingHeader,
    columns: l.columns,
    nonemptyCells: l.nonemptyCells,
    visibleSheets: l.visibleSheets,
    cellCharacters: l.cellCharacters,
    previewRows: 30,
    csvSampleBytes: 65536,
    dimensionScanBytes: 65536,
  };
}

export function resolveLimits(overrides?: Partial<IngestLimits>): IngestLimits {
  return { ...defaultLimits(), ...(overrides ?? {}) };
}
