/**
 * PreviewGrid — the bounded source preview: physical 1-based row/column
 * coordinates, values verbatim and direction-isolated, the pending header-row
 * choice visibly marked. Cells are user content: `dir="auto"` islands, never
 * translated or retyped.
 */
import type { I18n } from "@rowfolio/i18n";
import type { PreviewModel } from "./derive.ts";
import { columnLetter } from "./derive.ts";
import { cx } from "@rowfolio/ui";

export interface PreviewGridProps {
  i18n: I18n;
  preview: PreviewModel;
  headerRow?: number | undefined;
  testId?: string;
}

function cellText(cell: ReturnType<PreviewModel["cellAt"]>): string {
  if (!cell) return "";
  if (cell.type === "blank") return "";
  if (cell.type === "formula") return cell.cachedValue ?? cell.formula ?? "";
  const raw = cell.raw;
  if (raw === null) return "";
  return typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw);
}

export function PreviewGrid({ i18n, preview, headerRow, testId }: PreviewGridProps) {
  return (
    <div
      className="rf-table-scroll"
      role="region"
      aria-label={i18n.t("upload.range")}
      tabIndex={0}
      data-testid={testId ?? "upload-preview"}
    >
      <table className="rf-table">
        <caption>{i18n.t("upload.range")}</caption>
        <thead>
          <tr>
            <th scope="col" className="rf-table__sourcerow-head">
              <bdi dir="ltr">R#</bdi>
            </th>
            {preview.columns.map((column) => (
              <th key={column} scope="col">
                <bdi dir="ltr" className="rf-mono">
                  {columnLetter(column)}
                </bdi>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rowNumbers.map((row) => (
            <tr key={row} data-header={row === headerRow ? "true" : undefined} className={cx(row === headerRow && "rf-upload__preview-header")}>
              <td className="rf-table__sourcerow">
                <bdi dir="ltr">R{row}</bdi>
              </td>
              {preview.columns.map((column) => {
                const cell = preview.cellAt(row, column);
                const text = cellText(cell);
                return (
                  <td key={column} dir="auto">
                    {cell?.type === "formula" ? (
                      <bdi dir="ltr" className="rf-mono" title={i18n.t("limitations.cache")}>
                        {text}
                      </bdi>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
