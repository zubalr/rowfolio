import { describe, expect, it } from "vitest";
import type { Column, QualityIssue, RawCell } from "@rowfolio/contracts";
import {
  ambiguityKind,
  columnLetter,
  deriveCapabilities,
  groupIssues,
  previewModel,
  sampleValues,
  suggestHeaderRow,
  warningMessageKey,
} from "./derive.ts";

function cell(row: number, column: number, raw: string, type: RawCell["type"]): RawCell {
  return { row, column, raw, type, formula: null, cachedValue: null };
}

function column(partial: Partial<Column> & Pick<Column, "id" | "type">): Column {
  return {
    sourceColumn: 1,
    label: partial.id,
    role: "unknown",
    unit: { kind: "unknown", label: "", currency: null },
    additive: false,
    confirmed: false,
    nullable: false,
    ...partial,
  };
}

function issue(partial: Partial<QualityIssue> & Pick<QualityIssue, "id" | "kind">): QualityIssue {
  return {
    sourceRefId: "t",
    sourceRow: 1,
    fieldId: null,
    original: null,
    normalized: null,
    status: "proposed",
    action: "none",
    approval: "none",
    canonicalSourceRow: null,
    messageKey: "quality.issues",
    ...partial,
  };
}

describe("previewModel", () => {
  it("indexes cells by physical coordinates; blanks leave no entries", () => {
    const cells = [cell(1, 1, "h1", "text"), cell(2, 2, "9", "number"), cell(3, 1, "", "blank")];
    const m = previewModel(cells);
    expect(m.rowNumbers).toEqual([1, 2, 3]); // blank cells still occupy a row
    expect(m.columns).toEqual([1, 2]);
    expect(m.cellAt(2, 2)?.raw).toBe("9");
    expect(m.cellAt(9, 9)).toBeUndefined();
  });
});

describe("columnLetter", () => {
  it("converts 1-based columns to spreadsheet letters", () => {
    expect(columnLetter(1)).toBe("A");
    expect(columnLetter(26)).toBe("Z");
    expect(columnLetter(27)).toBe("AA");
    expect(columnLetter(52)).toBe("AZ");
  });
});

describe("suggestHeaderRow", () => {
  const inspection = (rowNumbers: number[], cells: RawCell[]) =>
    ({
      format: "csv",
      sourceName: "t.csv",
      sourceHash: "0".repeat(64),
      compressedBytes: 10,
      sheets: [],
      defaultSheetId: "s1",
      hiddenSheets: [],
      dateSystem: null,
      previewRows: cells,
      previewRowNumbers: rowNumbers,
      warnings: [],
    }) as unknown as Parameters<typeof suggestHeaderRow>[0];

  it("picks the modal-width row within the first 30 preview rows", () => {
    // Row 1 is a title (1 cell); rows 2+ are the table (3 cells) → header = 2.
    const cells = [
      cell(1, 1, "Report", "text"),
      cell(2, 1, "a", "text"), cell(2, 2, "b", "text"), cell(2, 3, "c", "text"),
      cell(3, 1, "x", "text"), cell(3, 2, "1", "number"), cell(3, 3, "y", "text"),
      cell(4, 1, "z", "text"), cell(4, 2, "2", "number"), cell(4, 3, "w", "text"),
    ];
    expect(suggestHeaderRow(inspection([1, 2, 3, 4], cells))).toBe(2);
  });

  it("uniform tables default to the first row", () => {
    const cells = [
      cell(1, 1, "a", "text"), cell(1, 2, "b", "text"),
      cell(2, 1, "x", "text"), cell(2, 2, "1", "number"),
    ];
    expect(suggestHeaderRow(inspection([1, 2], cells))).toBe(1);
  });
});

describe("groupIssues", () => {
  it("groups duplicates by canonical row, isolates other kinds", () => {
    const issues = [
      issue({ id: "d1", kind: "duplicate", sourceRow: 5, canonicalSourceRow: 3, action: "exclude-row" }),
      issue({ id: "d2", kind: "duplicate", sourceRow: 7, canonicalSourceRow: 3, action: "exclude-row" }),
      issue({ id: "c1", kind: "category", sourceRow: 4, fieldId: "f1", action: "map-category" }),
      issue({ id: "m1", kind: "missing", sourceRow: 6 }),
      issue({ id: "fc1", kind: "formula-cache", fieldId: "f2", action: "use-cache" }),
      issue({ id: "a1", kind: "ambiguous-date", fieldId: "f3", action: "confirm-type" }),
      issue({ id: "h1", kind: "header" }),
    ];
    const g = groupIssues(issues);
    expect(g.duplicateGroups).toHaveLength(1);
    expect(g.duplicateGroups[0]!.canonicalSourceRow).toBe(3);
    expect(g.duplicateGroups[0]!.issues.map((i) => i.id)).toEqual(["d1", "d2"]);
    expect(g.category.map((i) => i.id)).toEqual(["c1"]);
    expect(g.missing.map((i) => i.id)).toEqual(["m1"]);
    expect(g.formulaCache.map((i) => i.id)).toEqual(["fc1"]);
    expect(g.confirmType.map((i) => i.id)).toEqual(["a1"]);
    expect(g.other.map((i) => i.id)).toEqual(["h1"]);
  });
});

describe("deriveCapabilities", () => {
  it("reports absent axes/measures and counts unresolved issues", () => {
    const columns = [
      column({ id: "f1", type: "text", role: "dimension" }),
      column({ id: "f2", type: "decimal", role: "measure", additive: true, confirmed: true }),
    ];
    const issues = [
      issue({ id: "m1", kind: "missing" }),
      issue({ id: "d1", kind: "duplicate", status: "proposed", action: "exclude-row" }),
    ];
    const caps = deriveCapabilities(columns, issues, {
      approvedIssueIds: new Set(),
      columnOverrides: new Map(),
      cacheColumns: new Set(),
    }, []);
    expect(caps.hasDateAxis).toBe(false);
    expect(caps.hasAdditiveMeasure).toBe(true);
    expect(caps.unresolvedCount).toBe(1);
    expect(caps.missingCount).toBe(1);
    expect(caps.hasFormulaCells).toBe(false);
  });
});

describe("ambiguityKind + warningMessageKey", () => {
  it("maps unconfirmed mixed/date/decimal proposals to confirmation hints", () => {
    expect(ambiguityKind(column({ id: "a", type: "date" }))).toBe("date");
    expect(ambiguityKind(column({ id: "b", type: "decimal" }))).toBe("number");
    expect(ambiguityKind(column({ id: "c", type: "mixed" }))).toBe("number");
    expect(ambiguityKind(column({ id: "d", type: "text" }))).toBe("none");
    expect(ambiguityKind(column({ id: "e", type: "date", confirmed: true }))).toBe("none");
  });

  it("maps known ingest warning codes to existing catalog keys", () => {
    expect(warningMessageKey("ingest.warn.hidden-sheets-excluded")).toBe("upload.hidden");
    expect(warningMessageKey("ingest.warn.formula-cells")).toBe("limitations.cache");
    expect(warningMessageKey("totally.unknown.code")).toBeNull();
  });
});

describe("sampleValues", () => {
  it("returns the first N distinct raw values in row order", () => {
    const cells = [
      cell(2, 1, "x", "text"), cell(3, 1, "x", "text"), cell(4, 1, "y", "text"),
      cell(5, 1, "z", "text"), cell(6, 1, "w", "text"),
    ];
    expect(sampleValues(cells, 1, 3)).toEqual(["x", "y", "z"]);
  });
});
