/**
 * Pure view-model derivations for the upload flow — no React, no I/O.
 * Everything here computes from real parser/inspection outputs or contract
 * profile shapes; nothing fabricates semantics.
 */
import type { Column, QualityIssue, RawCell } from "@rowfolio/contracts";
import type { SheetInfo, SourceInspection } from "@rowfolio/ingest";
import { WARNINGS } from "@rowfolio/ingest";
import type { UploadDecisions } from "./types.ts";

/** A preview grid: physical (1-based) row numbers × physical columns. */
export interface PreviewModel {
  /** Physical row numbers present in the preview band, ascending. */
  readonly rowNumbers: readonly number[];
  /** Physical column numbers present, ascending. */
  readonly columns: readonly number[];
  /** cellAt(row, column) → RawCell or undefined (gaps preserved). */
  cellAt(row: number, column: number): RawCell | undefined;
}

/** Build a sparse preview grid from bounded RawCell output. */
export function previewModel(cells: readonly RawCell[]): PreviewModel {
  const rows = new Set<number>();
  const cols = new Set<number>();
  const byPos = new Map<string, RawCell>();
  for (const cell of cells) {
    rows.add(cell.row);
    cols.add(cell.column);
    byPos.set(`${cell.row}:${cell.column}`, cell);
  }
  const rowNumbers = [...rows].sort((a, b) => a - b);
  const columns = [...cols].sort((a, b) => a - b);
  return {
    rowNumbers,
    columns,
    cellAt(row, column) {
      return byPos.get(`${row}:${column}`);
    },
  };
}

/** Spreadsheet-style column letter (1 → A, 27 → AA). */
export function columnLetter(column: number): string {
  let n = column;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Suggested header row for the confirmation control: the first preview row
 * whose width equals the modal width of the preview band — the documented
 * default rule (packages/ingest README §"Default header row") applied to the
 * bounded preview. The parser's authoritative choice lands in
 * `table.sourceRef.headerRow` after parse; the control only presets the picker.
 */
export function suggestHeaderRow(inspection: SourceInspection): number | undefined {
  const rows = inspection.previewRowNumbers;
  if (rows.length === 0) return undefined;
  const widths = new Map<number, number>();
  for (const cell of inspection.previewRows) {
    if (cell.type === "blank") continue;
    widths.set(cell.row, (widths.get(cell.row) ?? 0) + 1);
  }
  const counts = new Map<number, number>();
  let modalWidth = 0;
  let modalCount = -1;
  for (const row of rows) {
    const w = widths.get(row) ?? 0;
    counts.set(w, (counts.get(w) ?? 0) + 1);
    if ((counts.get(w) ?? 0) > modalCount) {
      modalCount = counts.get(w) ?? 0;
      modalWidth = w;
    }
  }
  for (const row of rows) {
    if ((widths.get(row) ?? 0) === modalWidth) return row;
  }
  return rows[0];
}

export interface SheetChoice {
  readonly info: SheetInfo;
  /** Physical dimension summary, e.g. {rows: 2400, columns: 12} — or null. */
  readonly rows: number | null;
  readonly columns: number | null;
}

export function sheetChoices(inspection: SourceInspection): {
  visible: SheetChoice[];
  hidden: SheetChoice[];
} {
  const toChoice = (info: SheetInfo): SheetChoice => ({
    info,
    rows: info.dimensions ? info.dimensions.lastRow - info.dimensions.firstRow + 1 : null,
    columns: info.dimensions ? info.dimensions.lastColumn - info.dimensions.firstColumn + 1 : null,
  });
  return {
    visible: inspection.sheets.filter((s) => s.visibility === "visible").map(toChoice),
    hidden: inspection.sheets.filter((s) => s.visibility !== "visible").map(toChoice),
  };
}

/**
 * Map ingest warning codes to declared catalog keys where a semantically
 * exact key exists; unmapped codes render as stable diagnostic tokens inside a
 * generic quality-disclosure item (never raw messages, never source content).
 * Missing dedicated keys are a catalog change request to A04 — see the PR body.
 */
export function warningMessageKey(code: string): string | null {
  switch (code) {
    case WARNINGS.hiddenSheetsExcluded:
    case WARNINGS.hiddenSheetSelected:
      return "upload.hidden";
    case WARNINGS.multiSheetWorkbook:
      return "upload.sheet";
    case WARNINGS.formulaCellsPresent:
      return "limitations.cache";
    case WARNINGS.mergedCellsInRange:
      return "upload.range";
    case WARNINGS.invalidDateSerial:
      return "upload.ambiguousDate";
    default:
      return null;
  }
}

export interface IssueGroups {
  /** kind 'duplicate' + action 'exclude-row', grouped by their canonical row. */
  readonly duplicateGroups: readonly {
    canonicalSourceRow: number;
    issues: readonly QualityIssue[];
  }[];
  /** kind 'category' + action 'map-category' — individually approvable. */
  readonly category: readonly QualityIssue[];
  /** kind 'missing' — disclosed, never auto-filled (action 'none'). */
  readonly missing: readonly QualityIssue[];
  /** kind 'formula-cache' + action 'use-cache' — per-field opt-in. */
  readonly formulaCache: readonly QualityIssue[];
  /** kind 'ambiguous-date'/'confirm-type' — resolved via column confirmation. */
  readonly confirmType: readonly QualityIssue[];
  /** Everything else — disclosed via its declared messageKey. */
  readonly other: readonly QualityIssue[];
}

export function groupIssues(issues: readonly QualityIssue[]): IssueGroups {
  const dupByCanonical = new Map<number, QualityIssue[]>();
  const category: QualityIssue[] = [];
  const missing: QualityIssue[] = [];
  const formulaCache: QualityIssue[] = [];
  const confirmType: QualityIssue[] = [];
  const other: QualityIssue[] = [];

  for (const issue of issues) {
    if (issue.kind === "duplicate" && issue.action === "exclude-row") {
      const key = issue.canonicalSourceRow ?? issue.sourceRow;
      const list = dupByCanonical.get(key) ?? [];
      list.push(issue);
      dupByCanonical.set(key, list);
    } else if (issue.kind === "category" && issue.action === "map-category") {
      category.push(issue);
    } else if (issue.kind === "missing") {
      missing.push(issue);
    } else if (issue.kind === "formula-cache" && issue.action === "use-cache") {
      formulaCache.push(issue);
    } else if (issue.action === "confirm-type" || issue.kind === "ambiguous-date") {
      confirmType.push(issue);
    } else {
      other.push(issue);
    }
  }

  const duplicateGroups = [...dupByCanonical.entries()]
    .sort(([a], [b]) => a - b)
    .map(([canonicalSourceRow, list]) => ({
      canonicalSourceRow,
      issues: [...list].sort((a, b) => a.sourceRow - b.sourceRow),
    }));
  return { duplicateGroups, category, missing, formulaCache, confirmType, other };
}

/** Columns awaiting a user decision (proposed but not yet confirmed). */
export function pendingColumns(proposedColumns: readonly Column[], decisions: UploadDecisions): Column[] {
  return proposedColumns.filter((c) => !c.confirmed && !decisions.columnOverrides.has(c.id));
}

/** Effective columns after user overrides. */
export function effectiveColumns(proposedColumns: readonly Column[], decisions: UploadDecisions): Column[] {
  return proposedColumns.map((c) => decisions.columnOverrides.get(c.id) ?? c);
}

/** Up to `max` distinct raw values from one physical source column (as-authored strings). */
export function sampleValues(cells: readonly RawCell[], sourceColumn: number, max = 3): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const sorted = [...cells].sort((a, b) => a.row - b.row);
  for (const cell of sorted) {
    if (cell.column !== sourceColumn) continue;
    const raw = cell.type === "formula" ? (cell.cachedValue ?? cell.formula) : cell.raw;
    const text = raw === null ? "" : typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw);
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

export interface CapabilitySummary {
  /** A confirmed date column exists → period comparisons possible. */
  readonly hasDateAxis: boolean;
  /** A confirmed additive measure exists → KPI/scenario possible. */
  readonly hasAdditiveMeasure: boolean;
  /** Proposed issues the user has not approved and that are not disclosures. */
  readonly unresolvedCount: number;
  /** Missing-optional disclosure count. */
  readonly missingCount: number;
  /** Formula cells exist in the parsed table. */
  readonly hasFormulaCells: boolean;
  /** Columns the user opted into unverified cached values for. */
  readonly cacheOptInCount: number;
}

export function deriveCapabilities(
  columns: readonly Column[],
  issues: readonly QualityIssue[],
  decisions: UploadDecisions,
  tableWarnings: readonly string[],
): CapabilitySummary {
  const approved = decisions.approvedIssueIds;
  let unresolved = 0;
  for (const issue of issues) {
    if (issue.action !== "none" && issue.status === "proposed" && !approved.has(issue.id)) {
      unresolved += 1;
    }
  }
  return {
    hasDateAxis: columns.some((c) => c.confirmed && c.type === "date"),
    hasAdditiveMeasure: columns.some((c) => c.confirmed && c.role === "measure" && c.additive),
    unresolvedCount: unresolved,
    missingCount: issues.filter((i) => i.kind === "missing").length,
    hasFormulaCells:
      tableWarnings.includes(WARNINGS.formulaCellsPresent) ||
      issues.some((i) => i.kind === "formula-cache"),
    cacheOptInCount: decisions.cacheColumns.size,
  };
}

/** Proposed-type → which ambiguity hint applies (date order vs numeric separators). */
export function ambiguityKind(column: Column): "date" | "number" | "none" {
  if (column.confirmed) return "none";
  if (column.type === "date") return "date";
  if (column.type === "decimal" || column.type === "integer" || column.type === "mixed") {
    return "number";
  }
  return "none";
}
