/**
 * Canonical row-span compression: sorted, disjoint, non-adjacent inclusive
 * spans. Gaps are never merged (`[2,4,9]` stays three spans); contiguous
 * runs collapse (`[2,3,4]` becomes one span). The sum of span lengths always
 * equals the contributing row count, so a selection can never claim a
 * contiguous range that includes non-contributors.
 */
import type { RowSpan } from '@rowfolio/contracts';

/** Compress physical source rows into canonical spans. */
export function canonicalizeSpans(rows: readonly number[]): RowSpan[] {
  const points = [...new Set(rows)].filter((n) => Number.isInteger(n) && n >= 1).sort((a, b) => a - b);
  const spans: RowSpan[] = [];
  for (const point of points) {
    const last = spans[spans.length - 1];
    if (last !== undefined && point === last.end + 1) {
      last.end = point;
    } else {
      spans.push({ start: point, end: point });
    }
  }
  return spans;
}

/**
 * Legitimate source-row envelope: no selection can address more physical
 * rows than the ingestion cap admits (policy `limits.rowsIncludingHeader`).
 * Expansion beyond this is always hostile or corrupt — never a real table.
 */
export const MAX_EXPANDED_ROWS = 50000;

export class SpanError extends Error {
  readonly code: 'span-invalid' | 'span-overflow';
  constructor(code: SpanError['code'], message: string) {
    super(message);
    this.name = 'SpanError';
    this.code = code;
  }
}

/** Validate one span's bounds without allocating anything. */
function checkSpanBounds(span: RowSpan, index: number): void {
  const { start, end } = span;
  if (typeof start !== 'number' || typeof end !== 'number'
    || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw new SpanError('span-invalid', `span ${index} bounds must be finite numbers`);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new SpanError('span-invalid', `span ${index} bounds must be integers`);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new SpanError('span-invalid', `span ${index} bounds exceed safe integers`);
  }
  if (start < 1) {
    throw new SpanError('span-invalid', `span ${index} starts before row 1`);
  }
  if (end > MAX_EXPANDED_ROWS) {
    throw new SpanError('span-invalid', `span ${index} ends past the ${MAX_EXPANDED_ROWS}-row source envelope`);
  }
  if (start > end) {
    throw new SpanError('span-invalid', `span ${index} is inverted (${start} > ${end})`);
  }
}

/**
 * Expand canonical spans back into physical rows in order.
 *
 * Total cardinality is checked mathematically BEFORE any allocation or
 * iteration, so a hostile `[{start:1,end:2^31-1}]` fails typed instead of
 * exhausting the heap. Malformed, reversed, non-finite, and unsafe-integer
 * spans are refused the same way.
 */
export function expandSpans(spans: readonly RowSpan[], maxRows: number = MAX_EXPANDED_ROWS): number[] {
  if (!Number.isSafeInteger(maxRows) || maxRows < 0) {
    throw new SpanError('span-invalid', 'maxRows must be a non-negative safe integer');
  }
  let total = 0;
  spans.forEach((span, i) => {
    checkSpanBounds(span, i);
    total += span.end - span.start + 1;
    if (total > maxRows) {
      throw new SpanError(
        'span-overflow',
        `spans expand to more than ${maxRows} rows (refused before allocation)`,
      );
    }
  });
  const rows: number[] = [];
  for (const span of spans) {
    for (let n = span.start; n <= span.end; n += 1) rows.push(n);
  }
  return rows;
}

/** Sum of span lengths — must equal the selection rowCount. */
export function spanRowCount(spans: readonly RowSpan[]): number {
  return spans.reduce((acc, span) => acc + (span.end - span.start + 1), 0);
}

export interface SpanProblems {
  readonly valid: boolean;
  readonly problems: readonly string[];
}

/** Structural check: sorted, disjoint, non-adjacent, start ≤ end, count reconciles. */
export function validateSpans(spans: readonly RowSpan[], rowCount: number): SpanProblems {
  const problems: string[] = [];
  spans.forEach((span, i) => {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) {
      problems.push(`span ${i} bounds must be integers`);
    }
    if (span.start > span.end) problems.push(`span ${i} is inverted (${span.start} > ${span.end})`);
    if (span.start < 1) problems.push(`span ${i} starts before row 1`);
    const prev = spans[i - 1];
    if (prev !== undefined) {
      if (span.start < prev.start) problems.push(`spans unsorted at index ${i}`);
      if (span.start <= prev.end) problems.push(`spans overlap at index ${i}`);
      if (span.start === prev.end + 1) problems.push(`spans ${i - 1} and ${i} are adjacent (not canonical)`);
    }
  });
  if (spanRowCount(spans) !== rowCount) {
    problems.push(`rowCount ${rowCount} does not reconcile with span lengths ${spanRowCount(spans)}`);
  }
  return { valid: problems.length === 0, problems };
}
