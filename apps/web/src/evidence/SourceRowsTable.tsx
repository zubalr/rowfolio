/**
 * SourceRowsTable — the source browser for one RowSelection.
 *
 * Rows are paged through the injected `readEvidencePage` service (never sliced
 * locally — the Provenance service is the arbiter of which physical rows
 * contribute and in which order). Pages append via "Show more rows" so the
 * full contributing extent stays visible and honest. Cells are rendered
 * verbatim from `NormalizedRow.values` with raw→clean changes shown inline as
 * `<s>original</s> normalized` from the quality-issue ledger — text is always
 * escaped by React, never injected as markup.
 */
import { useCallback, useMemo, useState } from "react";
import {
  isDecimal,
  type Column,
  type NormalizedRow,
  type NormalizedTable,
  type QualityIssue,
  type RowSelection,
} from "@rowfolio/contracts";
import type { I18n, MessageKey } from "@rowfolio/i18n";
import { Bidi, cx } from "@rowfolio/ui";
import { rowIdToSourceRow } from "./model.ts";
import type { EvidencePage, EvidenceServices } from "./types.ts";

const ELLIPSIS = "·";

interface SourceRowsTableProps {
  table: NormalizedTable;
  selection: RowSelection;
  services: EvidenceServices;
  issueByCell: ReadonlyMap<string, QualityIssue[]>;
  /** Issues keyed by canonical physical row (exclusion reasons). */
  issueByRow: ReadonlyMap<number, QualityIssue[]>;
  i18n: I18n;
  pageSize: number;
  /** Rendered row-cap for review; selections never exceed the dataset cap. */
  maxRows: number;
}

/** Visible columns in the selection's declared field order; all columns when unset. */
function visibleColumns(table: NormalizedTable, selection: RowSelection): Column[] {
  if (selection.fieldIds.length === 0) return table.columns;
  const byId = new Map(table.columns.map((c) => [c.id, c]));
  const cols = selection.fieldIds
    .map((id) => byId.get(id))
    .filter((c): c is Column => c !== undefined);
  return cols.length === 0 ? table.columns : cols;
}

function CellBody({
  row,
  column,
  issues,
}: {
  row: NormalizedRow;
  column: Column;
  issues: readonly QualityIssue[];
}) {
  const value = row.values[column.id] ?? null;
  // A ledger entry whose stored original differs from the normalized cell is a
  // raw→clean change on this exact cell; render original struck through.
  const change = issues.find(
    (q) => q.original !== null && q.normalized !== value,
  );
  const numeric = typeof value === "string" && isDecimal(value);
  const valueNode =
    value === null ? (
      <span className="rf-evidence__empty">{ELLIPSIS}</span>
    ) : (
      <Bidi dir={numeric || typeof value === "boolean" ? "ltr" : "auto"} className={cx(numeric && "rf-evidence__num")}>
        {typeof value === "boolean" ? (value ? "true" : "false") : value}
      </Bidi>
    );
  return (
    <span className={cx("rf-evidence__cell", change !== undefined && "rf-evidence__cell--changed")}>
      {change !== undefined ? (
        <s className="rf-evidence__cell-original">
          <Bidi dir="auto">{change.original}</Bidi>
        </s>
      ) : null}
      {valueNode}
    </span>
  );
}

export function SourceRowsTable({
  table,
  selection,
  services,
  issueByCell,
  issueByRow,
  i18n,
  pageSize,
  maxRows,
}: SourceRowsTableProps) {
  const [pageCount, setPageCount] = useState(1);
  const columns = useMemo(() => visibleColumns(table, selection), [table, selection]);

  const pages = useMemo(() => {
    const out: EvidencePage[] = [];
    let offset = 0;
    for (let i = 0; i < pageCount; i += 1) {
      const page = services.readEvidencePage(table, selection, offset, pageSize);
      out.push(page);
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    return out;
  }, [services, table, selection, pageSize, pageCount]);

  const rows = useMemo(() => pages.flatMap((p) => [...p.rows]), [pages]);
  const lastPage = pages.at(-1);
  const total = lastPage?.total ?? selection.rowCount;
  const canLoadMore =
    lastPage !== undefined &&
    lastPage.nextOffset !== null &&
    rows.length < Math.min(total, maxRows);

  const loadMore = useCallback(() => setPageCount((n) => n + 1), []);

  const excludedRowNumbers = useMemo(
    () =>
      selection.excludedRowIds
        .map((id) => rowIdToSourceRow(id))
        .filter((n): n is number => n !== null),
    [selection],
  );

  return (
    <div className="rf-evidence__rows" data-testid={`evidence-rows-${selection.id}`}>
      <div
        className="rf-evidence__rows-scroll"
        role="group"
        aria-label={`${i18n.t("evidence.sourceRows")} · ${selection.id}`}
        tabIndex={0}
      >
        <table className="rf-table rf-evidence__table">
          <caption className="rf-visually-hidden">
            {i18n.t("evidence.sourceRows")} · {i18n.plural("count.records", total)}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="rf-evidence__col-row">
                {i18n.t("common.rows")}
              </th>
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  className={cx(
                    (col.type === "decimal" || col.type === "integer") && "rf-evidence__col-num",
                  )}
                >
                  <Bidi dir="auto">{col.label}</Bidi>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowIssues = issueByRow.get(row.sourceRow) ?? [];
              const flagged = rowIssues.length > 0;
              return (
                <tr key={row.id} data-source-row={row.sourceRow}>
                  <th scope="row" className="rf-evidence__col-row">
                    <Bidi dir="ltr" className="rf-evidence__num">
                      R{row.sourceRow}
                    </Bidi>
                    {flagged ? (
                      <span
                        className="rf-evidence__flag"
                        title={rowIssues.map((q) => i18n.tSafe(q.messageKey as MessageKey)).join(" · ")}
                      >
                        ●
                      </span>
                    ) : null}
                  </th>
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cx(
                        (col.type === "decimal" || col.type === "integer") &&
                          "rf-evidence__col-num",
                      )}
                    >
                      <CellBody
                        row={row}
                        column={col}
                        issues={issueByCell.get(`${row.sourceRow}:${col.id}`) ?? []}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="rf-evidence__empty">
                  {i18n.t("evidence.noRows")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="rf-evidence__pager">
        <span className="rf-evidence__pager-status">
          {i18n.t("evidence.more", {
            start: 1,
            end: rows.length,
            total,
          })}
        </span>
        {canLoadMore ? (
          <button type="button" className="rf-linkbtn" onClick={loadMore}>
            {i18n.t("action.moreRows")}
          </button>
        ) : null}
        {excludedRowNumbers.length > 0 ? (
          <span className="rf-evidence__pager-status rf-evidence__pager-status--excluded">
            {i18n.t("evidence.exclusions")}:{" "}
            {excludedRowNumbers.map((n) => (
              <Bidi dir="ltr" className="rf-evidence__id" key={n}>
                R{n}
              </Bidi>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}
