/**
 * DataTable — the source/evidence table primitive.
 *
 * Secondary presentation surface: sticky scoped headers, a caption, visible
 * one-based physical source-row numbers as LTR mono islands, a labelled
 * scroll region (the page itself must not overflow), and "show more rows"
 * pagination that never mounts thousands of hidden focusable cells.
 * Values are contract `CellValue`s — user content renders verbatim and
 * direction-isolated; the table does not recompute anything.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { CellValue } from "@rowfolio/contracts";
import { cx } from "../cx.ts";
import { Button } from "./Button.tsx";

export interface DataTableColumn {
  id: string;
  /** Localized column heading. */
  label: string;
  align?: "start" | "end" | "center";
  /** Render in mono/tabular figures (numbers, source IDs). */
  mono?: boolean;
  /**
   * Cell direction override: "ltr" pins Latin source IDs/numerics;
   * "auto" lets user-authored text choose its own direction. Defaults to the
   * column's natural flow (inherit).
   */
  dir?: "ltr" | "auto";
}

export interface DataTableRow {
  id: string;
  /** One-based physical source row, shown verbatim. */
  sourceRow?: number;
  values: Record<string, CellValue>;
}

export interface DataTableProps {
  /** Accessible table caption (also visible). */
  caption: string;
  columns: readonly DataTableColumn[];
  rows: readonly DataTableRow[];
  /** aria-label for the scrollable region. */
  scrollLabel: string;
  /** Visible pagination footer, e.g. "Rows {start}–{end} of {total}". */
  rangeLabel?: (start: number, end: number, total: number) => string;
  /** Localized "show more" label for the pagination button. */
  moreLabel?: string;
  /** Rows revealed initially / per step (spec default: 50). */
  pageSize?: number;
  /** Empty-state content when rows is empty. */
  emptyState?: ReactNode;
  /** Show the physical source-row column (default true when any row has one). */
  showSourceRows?: boolean;
  /** Reset pagination when this changes (e.g. dataset revision). */
  resetKey?: string | number;
  maxHeight?: number;
  testId?: string;
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

export function DataTable({
  caption,
  columns,
  rows,
  scrollLabel,
  rangeLabel,
  moreLabel,
  pageSize = 50,
  emptyState,
  showSourceRows,
  resetKey,
  maxHeight,
  testId,
}: DataTableProps) {
  const [pageCount, setPageCount] = useState(1);
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    // Render-time reset keeps pagination honest when the data set changes.
    setLastResetKey(resetKey);
    setPageCount(1);
  }
  const visible = useMemo(() => rows.slice(0, pageCount * pageSize), [rows, pageCount, pageSize]);
  const anySourceRow = showSourceRows ?? rows.some((r) => r.sourceRow !== undefined);
  const allShown = visible.length >= rows.length;
  return (
    <div className="rf-table-wrap" data-testid={testId}>
      <div
        className="rf-table-scroll"
        role="region"
        aria-label={scrollLabel}
        tabIndex={0}
        style={maxHeight ? ({ "--rf-table-max-height": `${maxHeight}px` } as CSSProperties) : undefined}
      >
        <table className="rf-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              {anySourceRow ? (
                <th scope="col" className="rf-table__sourcerow-head">
                  <bdi dir="ltr">R#</bdi>
                </th>
              ) : null}
              {columns.map((col) => (
                <th key={col.id} scope="col" data-align={col.align}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                {anySourceRow ? (
                  <td className="rf-table__sourcerow">
                    {row.sourceRow !== undefined ? <bdi dir="ltr">R{row.sourceRow}</bdi> : null}
                  </td>
                ) : null}
                {columns.map((col) => {
                  const value = row.values[col.id];
                  const text = cellText(value ?? null);
                  const dir = col.dir ?? (col.mono ? "ltr" : undefined);
                  return (
                    <td
                      key={col.id}
                      data-align={col.align}
                      className={cx(col.mono && "rf-mono")}
                      dir={dir}
                    >
                      {dir || col.mono ? <bdi dir={dir ?? "ltr"}>{text}</bdi> : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && emptyState ? <div>{emptyState}</div> : null}
      </div>
      {rows.length > 0 && (rangeLabel || !allShown) ? (
        <div className="rf-table__foot">
          <span>
            {rangeLabel
              ? rangeLabel(visible.length === 0 ? 0 : 1, visible.length, rows.length)
              : null}
          </span>
          {!allShown && moreLabel ? (
            <Button variant="secondary" onClick={() => setPageCount((n) => n + 1)}>
              {moreLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
