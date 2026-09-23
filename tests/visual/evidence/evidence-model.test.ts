/**
 * Unit tests for the evidence view-model + reference service adapter.
 *
 * The adapter assertions double as reconciliation evidence: every value the
 * dialog displays is recomputed by the real contracts evaluator and compared
 * to the fixture's stored `proof.result`.
 */
import { describe, expect, it } from "vitest";
import type { RowSelection } from "../../../packages/contracts/src/index.ts";
import {
  EvidenceError,
  issuesInSelection,
  resolveEvidenceSubject,
  resultsAgree,
  rowIdToSourceRow,
  selectionRowNumbers,
  spanTokens,
  subjectCaveats,
  subjectSelections,
  subjectTransformIds,
} from "../../../apps/web/src/evidence/index.ts";
import {
  bundleFor,
  scenarioFixture,
  SNAPSHOT,
  TABLE,
} from "./support/fixtures.ts";
import { referenceServices } from "./support/services.ts";

describe("resolveEvidenceSubject", () => {
  it("resolves metrics and proofs in finding order", () => {
    const subject = resolveEvidenceSubject(bundleFor("finding-north-target"));
    expect(subject.metrics.map((m) => m.id)).toEqual([
      "north-june-revenue",
      "north-june-target",
      "north-target-gap",
      "north-orders-change",
    ]);
    expect(subject.proofs.map((p) => p.id)).toHaveLength(4);
  });

  it("throws a typed error for an unknown findingId", () => {
    expect(() => resolveEvidenceSubject(bundleFor("nope"))).toThrowError(EvidenceError);
    try {
      resolveEvidenceSubject(bundleFor("nope"));
    } catch (error) {
      expect((error as EvidenceError).code).toBe("evidence.finding.missing");
    }
  });

  it("throws a typed error for a dangling metric reference", () => {
    const snapshot = JSON.parse(JSON.stringify(SNAPSHOT)) as typeof SNAPSHOT;
    snapshot.metrics = snapshot.metrics.filter((m) => m.id !== "north-june-revenue");
    expect(() =>
      resolveEvidenceSubject({ snapshot, table: TABLE, findingId: "finding-north-target" }),
    ).toThrowError(/evidence\.reference\.missing/);
  });
});

describe("spanTokens", () => {
  const selection = (spans: { start: number; end: number }[]): RowSelection => ({
    id: "s",
    sourceRefId: "source-operations",
    spans,
    rowCount: spans.reduce((n, s) => n + (s.end - s.start + 1), 0),
    fieldIds: [],
    excludedRowIds: [],
    maskPolicy: "shared-valid",
  });

  it("renders disjoint spans as separate tokens — never collapsed", () => {
    expect(spanTokens(selection([{ start: 1202, end: 1221 }, { start: 1300, end: 1320 }]))).toEqual([
      "R1202-R1221",
      "R1300-R1320",
    ]);
  });

  it("renders a single row as one token", () => {
    expect(spanTokens(selection([{ start: 2402, end: 2402 }]))).toEqual(["R2402"]);
  });

  it("does not merge adjacent-but-separate spans", () => {
    expect(spanTokens(selection([{ start: 5, end: 6 }, { start: 7, end: 8 }]))).toEqual([
      "R5-R6",
      "R7-R8",
    ]);
  });
});

describe("selection row helpers", () => {
  it("expands spans into physical source rows", () => {
    const sel: RowSelection = {
      id: "s",
      sourceRefId: "x",
      spans: [{ start: 3, end: 5 }],
      rowCount: 3,
      fieldIds: [],
      excludedRowIds: [],
      maskPolicy: "all-retained",
    };
    expect(selectionRowNumbers(sel)).toEqual([3, 4, 5]);
  });

  it("parses row ids", () => {
    expect(rowIdToSourceRow("S0:R2402")).toBe(2402);
    expect(rowIdToSourceRow("garbage")).toBeNull();
  });

  it("collects ledger issues inside the selection's physical span", () => {
    const june = SNAPSHOT.provenance.find((p) => p.id === "june-revenue-proof");
    expect(june).toBeDefined();
    const inside = issuesInSelection(june!.selections[0]!, TABLE);
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.every((q) => q.sourceRow >= 1802 && q.sourceRow <= 2401)).toBe(true);
  });

  it("keeps finding limitations as subject caveats", () => {
    const subject = resolveEvidenceSubject(bundleFor("finding-quality"));
    const caveats = subjectCaveats(subject);
    expect(caveats.map((c) => c.messageKey)).toContain("limitations.missingRetained");
  });
});

describe("subject graph helpers", () => {
  it("dedupes selections across proofs (unique physical selections)", () => {
    const subject = resolveEvidenceSubject(bundleFor("finding-north-target"));
    const ids = subjectSelections(subject).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("north-june-revenue-rows");
  });

  it("unions transformIds across proofs without duplicates", () => {
    const subject = resolveEvidenceSubject(bundleFor("finding-north-target"));
    const ids = subjectTransformIds(subject);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe("reference services adapter", () => {
  const services = referenceServices(TABLE, SNAPSHOT.provenance);

  it("recomputes a sum proof exactly (oracle reconciliation)", () => {
    const proof = SNAPSHOT.provenance.find((p) => p.id === "north-june-revenue-proof")!;
    const out = services.evaluateProof(proof, TABLE, SNAPSHOT.metrics);
    expect(out.reasonKey).toBeNull();
    // canonical decimal equality: '881000' and '881000.00' are the same value
    expect(resultsAgree(out.value, proof.result)).toBe(true);
  });

  it("recomputes the ratio proof to full 40-digit precision", () => {
    const proof = SNAPSHOT.provenance.find((p) => p.id === "north-downtime-change-proof")!;
    const out = services.evaluateProof(proof, TABLE, SNAPSHOT.metrics);
    expect(out.value).toBe("0.3107202680067001675041876046901172529313");
  });

  it("returns the diagnostic code for an undefined proof (UI shows proof.reasonKey)", () => {
    const { bundle } = scenarioFixture("undefined-metric");
    const svcs = referenceServices(bundle.table, bundle.snapshot.provenance);
    const proof = bundle.snapshot.provenance.find((p) => p.id === "june-margin-proof")!;
    const out = svcs.evaluateProof(proof, bundle.table, bundle.snapshot.metrics);
    expect(out.value).toBeNull();
    // The evaluator reports WHY it failed (missing operand); the authored
    // i18n reason (`coverage.partial`) stays on the proof for display.
    expect(out.reasonKey).toBe("metric.missing");
    expect(proof.reasonKey).toBe("coverage.partial");
  });

  it("pages a 100-row selection at 50 rows per page", () => {
    const sel = SNAPSHOT.provenance
      .find((p) => p.id === "north-june-revenue-proof")!
      .selections.find((s) => s.id === "north-june-revenue-rows")!;
    const first = services.readEvidencePage(TABLE, sel, 0, 50);
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0]!.sourceRow).toBe(1802);
    expect(first.total).toBe(100);
    expect(first.nextOffset).toBe(50);
    const second = services.readEvidencePage(TABLE, sel, first.nextOffset!, 50);
    expect(second.rows).toHaveLength(50);
    expect(second.rows.at(-1)!.sourceRow).toBe(1901);
    expect(second.nextOffset).toBeNull();
  });

  it("excluded rows never appear in the paged set", () => {
    const sel = SNAPSHOT.provenance
      .find((p) => p.id === "june-revenue-proof")!
      .selections.find((s) => s.id === "june-revenue-rows")!;
    const page = services.readEvidencePage(TABLE, sel, 0, 500);
    // The span already shrank around ledger-excluded rows (2416–2418 sit
    // outside it); the paged set covers exactly the contributing extent.
    expect(page.total).toBe(600);
    const excluded = new Set([2416, 2417, 2418]);
    expect(page.rows.some((r) => excluded.has(r.sourceRow))).toBe(false);
    expect(sel.excludedRowIds).toHaveLength(3);
  });

  it("disjoint selection evaluates to 41 contributing rows", () => {
    const { bundle } = scenarioFixture("disjoint");
    const svcs = referenceServices(bundle.table, bundle.snapshot.provenance);
    const proof = bundle.snapshot.provenance.find((p) => p.id === "north-sparse-orders-proof")!;
    const out = svcs.evaluateProof(proof, bundle.table, bundle.snapshot.metrics);
    expect(out.value).toBe("41");
    const page = svcs.readEvidencePage(bundle.table, proof.selections[0]!, 0, 50);
    expect(page.total).toBe(41);
    expect(page.rows[0]!.sourceRow).toBe(1202);
    expect(page.rows[19]!.sourceRow).toBe(1221);
    expect(page.rows[20]!.sourceRow).toBe(1300);
  });
});
