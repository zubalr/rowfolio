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

/** Expand canonical spans back into physical rows in order. */
export function expandSpans(spans: readonly RowSpan[]): number[] {
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
