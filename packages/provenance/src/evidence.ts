/**
 * Bounded evidence pagination over a normalized table.
 *
 * Pages walk the selection's contributing rows in span order and resolve
 * each to its normalized row plus the ledger entries that touched it, so
 * the UI can show raw-vs-normalized differences without loading the full
 * selection. Page size is capped; offsets beyond the total return an empty
 * page rather than an error.
 */
import type {
  CellValue,
  NormalizedRow,
  NormalizedTable,
  QualityIssue,
  RowSelection,
} from '@rowfolio/contracts';

/**
 * Bounded evidence page. Structural mirror of the contract `EvidencePage`
 * interface (deep workspace imports are forbidden by repo convention).
 */
export interface EvidencePage {
  readonly rows: readonly NormalizedRow[];
  readonly offset: number;
  readonly total: number;
  readonly nextOffset: number | null;
}
import { ProofError } from './proof.ts';
import { expandSpans } from './spans.ts';

export const MAX_EVIDENCE_PAGE = 500;

export interface EvidenceRow {
  readonly row: NormalizedRow;
  /** Ledger entries recorded against this source row (transforms, exclusions). */
  readonly transforms: readonly QualityIssue[];
  /** Pre-normalization values recovered from the ledger, per changed field. */
  readonly originalValues: Readonly<Record<string, CellValue>>;
}

export function readEvidencePage(
  table: NormalizedTable,
  selection: RowSelection,
  offset: number,
  pageSize: number,
): EvidencePage {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ProofError('invalid-page', `offset must be a non-negative integer (got ${offset})`);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_EVIDENCE_PAGE) {
    throw new ProofError('invalid-page', `pageSize must be 1..${MAX_EVIDENCE_PAGE} (got ${pageSize})`);
  }
  const rowsBySource = new Map(table.rows.map((r) => [r.sourceRow, r] as const));
  const contributing = expandSpans(selection.spans).filter((n) => rowsBySource.has(n));
  const slice = contributing.slice(offset, offset + pageSize);
  const rows = slice.map((n) => rowsBySource.get(n) as NormalizedRow);
  const end = offset + rows.length;
  return {
    rows,
    offset,
    total: contributing.length,
    nextOffset: end < contributing.length ? end : null,
  };
}

/** Evidence row with its ledger context for raw-vs-normalized display. */
export function evidenceRow(table: NormalizedTable, sourceRow: number): EvidenceRow | null {
  const row = table.rows.find((r) => r.sourceRow === sourceRow);
  if (row === undefined) return null;
  const transforms = table.qualityIssues.filter((q) => q.sourceRow === sourceRow);
  const originalValues: Record<string, CellValue> = {};
  for (const t of transforms) {
    if (t.fieldId !== null && t.original !== null) originalValues[t.fieldId] = t.original;
  }
  return { row, transforms, originalValues };
}

/**
 * Wrap an identifier, formula or source range for direction isolation so
 * mixed-direction rendering keeps numbers and IDs in logical order.
 */
export function bidiIsolate(text: string): string {
  return `⁦${text}⁩`;
}
