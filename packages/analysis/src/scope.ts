/**
 * Scope row resolution and shared-mask aggregation.
 *
 * Periods compare ISO date-only strings lexicographically (valid for
 * `YYYY-MM-DD`). A row belongs to a metric only when every operand field
 * holds a finite decimal string; ratios always compute over one shared
 * row set, never over independently filtered sums.
 */
import { addDecimal, isDecimal } from '@rowfolio/contracts';
import type {
  Column,
  NormalizedRow,
  NormalizedTable,
  RowSpan,
} from '@rowfolio/contracts';

/** Canonical span compression (contract rule; local implementation). */
export function toSpans(rows: readonly number[]): RowSpan[] {
  const points = [...new Set(rows)].sort((a, b) => a - b);
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

/** Date column: the confirmed-or-proposed `date` role column. */
export function findDateColumn(table: NormalizedTable): Column | null {
  return table.columns.find((c) => c.role === 'date' && c.type === 'date') ?? null;
}

/** Region column: explicit `region` id only — never guessed from text. */
export function findRegionColumn(table: NormalizedTable): Column | null {
  return table.columns.find((c) => c.id === 'region') ?? null;
}

export interface Period {
  readonly start: string;
  readonly end: string;
}

/** Full calendar month immediately before the month containing `start`. */
export function previousMonthPeriod(start: string): Period {
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7));
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const lastDay = new Date(Date.UTC(prev.year, prev.month, 0)).getUTCDate();
  const mm = String(prev.month).padStart(2, '0');
  return {
    start: `${prev.year}-${mm}-01`,
    end: `${prev.year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

export interface ScopedRows {
  readonly rows: NormalizedRow[];
  readonly sourceRows: number[];
}

/** Rows with a date in `[start, end]` (and region in `regions` when non-empty). */
export function scopeRows(
  table: NormalizedTable,
  dateColumn: Column,
  period: Period,
  regionColumn: Column | null,
  regions: readonly string[],
): ScopedRows {
  const rows = table.rows.filter((row) => {
    const date = row.values[dateColumn.id];
    if (typeof date !== 'string' || date < period.start || date > period.end) return false;
    if (regions.length > 0 && regionColumn !== null) {
      return regions.includes(String(row.values[regionColumn.id] ?? ''));
    }
    return true;
  });
  return { rows, sourceRows: rows.map((r) => r.sourceRow) };
}

export interface FieldSum {
  readonly total: string;
  readonly eligible: number;
  readonly values: string[];
}

/** Exact sum over rows whose field holds a finite decimal (missing/invalid excluded). */
export function sumField(rows: readonly NormalizedRow[], field: string): FieldSum {
  let total = '0';
  let eligible = 0;
  const values: string[] = [];
  for (const row of rows) {
    const value = row.values[field];
    if (typeof value !== 'string' || !isDecimal(value)) continue;
    total = addDecimal(total, value);
    eligible += 1;
    values.push(value);
  }
  return { total, eligible, values };
}

/** Rows where every listed field is a finite decimal — the shared mask. */
export function sharedMask(rows: readonly NormalizedRow[], fields: readonly string[]): NormalizedRow[] {
  return rows.filter((row) =>
    fields.every((f) => typeof row.values[f] === 'string' && isDecimal(row.values[f] as string)),
  );
}

/** Scheduled dates of `calendarDates` inside a period (empty calendar ⇒ no constraint). */
export function scheduledInPeriod(calendarDates: readonly string[], period: Period): string[] {
  return calendarDates.filter((d) => d >= period.start && d <= period.end);
}

/** A period is complete when confirmed and every scheduled date has rows. */
export function isPeriodComplete(
  table: NormalizedTable,
  dateColumn: Column,
  period: Period,
  confirmed: boolean,
): boolean {
  if (!confirmed) return false;
  const scheduled = scheduledInPeriod(table.calendarDates, period);
  if (scheduled.length === 0) return confirmed && scopeRows(table, dateColumn, period, null, []).rows.length > 0;
  const present = new Set(
    scopeRows(table, dateColumn, period, null, []).rows.map((r) => String(r.values[dateColumn.id])),
  );
  return scheduled.every((d) => present.has(d));
}
