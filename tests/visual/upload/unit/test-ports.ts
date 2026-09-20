/**
 * Shared deterministic profiler for upload tests — kept deliberately small:
 * dominant physical type proposes the column type; mixed number+date bodies
 * are ambiguous-date candidates; formula cells raise per-column cache issues;
 * identical body rows raise exclude-row duplicates; empty body cells raise
 * missing disclosures. It proposes, it never applies.
 */
import type { Column, QualityIssue, RawTable } from "@rowfolio/contracts";
import { columnLetter } from "../../../../apps/web/src/upload/derive.ts";

const UNIT = { kind: "unknown", label: "", currency: null } as const;

function rawText(raw: string | boolean | null): string {
  if (raw === null) return "";
  return typeof raw === "boolean" ? (raw ? "true" : "false") : raw;
}

export function testProfile(raw: RawTable): { proposedColumns: Column[]; issues: QualityIssue[] } {
  const { headerRow, range } = raw.sourceRef;
  const proposedColumns: Column[] = [];
  const issues: QualityIssue[] = [];
  const bodyRows = range.lastRow - headerRow;

  for (let c = range.firstColumn; c <= range.lastColumn; c++) {
    const id = `f${c}`;
    const header = raw.cells.find((cell) => cell.row === headerRow && cell.column === c);
    const body = raw.cells.filter(
      (cell) => cell.row > headerRow && cell.column === c && cell.type !== "blank",
    );
    const types = new Set(body.map((cell) => cell.type));
    const hasDate = types.has("date");
    const hasNumber = types.has("number");
    const hasFormula = types.has("formula");
    let type: Column["type"];
    if (types.size === 1 && hasDate) type = "date";
    else if (types.size === 1 && hasNumber) type = "decimal";
    else if (types.size === 1 && types.has("boolean")) type = "boolean";
    else if (types.size > 1) type = "mixed";
    else type = "text";
    proposedColumns.push({
      id,
      sourceColumn: c,
      label: header === undefined ? columnLetter(c) : rawText(header.raw) || columnLetter(c),
      type,
      role: type === "date" ? "date" : type === "decimal" ? "measure" : "dimension",
      unit: { ...UNIT },
      additive: type === "decimal",
      confirmed: false,
      nullable: body.length < bodyRows,
    });

    if (hasFormula) {
      issues.push({
        id: `cache-${id}`,
        kind: "formula-cache",
        sourceRefId: raw.id,
        sourceRow: body.find((cell) => cell.type === "formula")!.row,
        fieldId: id,
        original: null,
        normalized: null,
        status: "proposed",
        action: "use-cache",
        approval: "none",
        canonicalSourceRow: null,
        messageKey: "limitations.cache",
      });
    }
    if (hasDate && hasNumber) {
      issues.push({
        id: `ambdate-${id}`,
        kind: "ambiguous-date",
        sourceRefId: raw.id,
        sourceRow: body[0]?.row ?? headerRow + 1,
        fieldId: id,
        original: null,
        normalized: null,
        status: "proposed",
        action: "confirm-type",
        approval: "none",
        canonicalSourceRow: null,
        messageKey: "upload.ambiguousDate",
      });
    }
    if (body.length < bodyRows) {
      issues.push({
        id: `missing-${id}`,
        kind: "missing",
        sourceRefId: raw.id,
        sourceRow: headerRow + 1,
        fieldId: id,
        original: null,
        normalized: null,
        status: "proposed",
        action: "none",
        approval: "none",
        canonicalSourceRow: null,
        messageKey: "quality.missing",
      });
    }
  }

  const seen = new Map<string, number>();
  for (let r = headerRow + 1; r <= range.lastRow; r++) {
    const key = raw.cells
      .filter((cell) => cell.row === r)
      .map((cell) => rawText(cell.raw))
      .join("");
    const prior = seen.get(key);
    if (prior !== undefined) {
      issues.push({
        id: `dup-${r}`,
        kind: "duplicate",
        sourceRefId: raw.id,
        sourceRow: r,
        fieldId: null,
        original: null,
        normalized: null,
        status: "proposed",
        action: "exclude-row",
        approval: "none",
        canonicalSourceRow: prior,
        messageKey: "quality.duplicate",
      });
    } else {
      seen.set(key, r);
    }
  }
  return { proposedColumns, issues };
}
