/**
 * Fixture loading for the evidence harness + tests.
 *
 * Loads the published contract examples and validates them through the real
 * schema/semantic checks, so the UI is always exercised against wire-valid
 * documents. Scenario variants are built by deep-cloning and mutating the
 * cloned objects — the canonical fixtures on disk are never modified.
 */
import {
  assertAnalysisSnapshot,
  assertNormalizedTable,
  type AnalysisSnapshot,
  type Finding,
  type Metric,
  type NormalizedTable,
  type Provenance,
  type RowSelection,
} from "../../../../packages/contracts/src/index.ts";
import rawSnapshot from "../../../contract/fixtures/analysis-snapshot.example.json";
import rawTable from "../../../contract/fixtures/normalized-table.example.json";
import type { EvidenceBundle } from "../../../../apps/web/src/evidence/index.ts";
import {
  MALICIOUS_ID,
  MALICIOUS_SITE,
  type EvidenceScenario,
} from "./strings.ts";

export type { EvidenceScenario };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const TABLE: NormalizedTable = assertNormalizedTable(clone(rawTable));
// The snapshot's count-issues expressions reference the ledger — supply the
// table so cross-document checks resolve them.
export const SNAPSHOT: AnalysisSnapshot = assertAnalysisSnapshot(clone(rawSnapshot), {
  table: TABLE,
});

export function bundleFor(findingId: string, overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return { snapshot: SNAPSHOT, table: TABLE, findingId, ...overrides };
}

const baseFinding = SNAPSHOT.findings.find((f) => f.id === "finding-north-target");
if (baseFinding === undefined) throw new Error("fixture missing finding-north-target");
const BASE: Finding = baseFinding;

function findProof(id: string): Provenance {
  const p = SNAPSHOT.provenance.find((x) => x.id === id);
  if (p === undefined) throw new Error(`fixture missing ${id}`);
  return p;
}

function findMetric(id: string): Metric {
  const m = SNAPSHOT.metrics.find((x) => x.id === id);
  if (m === undefined) throw new Error(`fixture missing ${id}`);
  return m;
}

/** Rank payload reused by synthesized findings — shape-only, never displayed. */
function synthRank(coverage = "1", magnitude = "0") {
  return { classPriority: 9, coverage, magnitude };
}



/**
 * A single metric whose two disjoint spans must render as `R1202–R1221 ·
 * R1300–R1320` — never collapsed into `R1202–R1320` (which would claim 20
 * extra rows contribute). `count-rows` keeps evaluation honest: the oracle
 * recomputes 41 from the fixture rows.
 */
function disjointSnapshot(): AnalysisSnapshot {
  const snap = clone(SNAPSHOT);
  const sparseRows: RowSelection = {
    id: "north-sparse-rows",
    sourceRefId: TABLE.sourceRef.id,
    spans: [
      { start: 1202, end: 1221 },
      { start: 1300, end: 1320 },
    ],
    rowCount: 41,
    fieldIds: ["order_volume"],
    excludedRowIds: [],
    maskPolicy: "shared-valid",
  };
  const proof: Provenance = clone(findProof("north-may-orders-proof"));
  proof.id = "north-sparse-orders-proof";
  proof.selections = [sparseRows];
  proof.expression = { op: "count-rows", selectionId: "north-sparse-rows" };
  proof.result = "41";
  proof.transformIds = [];
  const metric: Metric = clone(findMetric("north-may-orders"));
  metric.id = "north-sparse-orders";
  metric.value = "41";
  metric.eligibleRows = 41;
  metric.totalRows = 41;
  metric.provenanceId = "north-sparse-orders-proof";
  const finding: Finding = clone(BASE);
  finding.id = "finding-disjoint-demo";
  finding.metricIds = ["north-sparse-orders"];
  finding.provenanceIds = ["north-sparse-orders-proof"];
  finding.qualityIssueIds = [];
  finding.rank = synthRank();
  snap.metrics.push(metric);
  snap.provenance.push(proof);
  snap.findings.push(finding);
  return snap;
}

/** `june-margin` flipped to undefined with a real coverage reason key. */
function undefinedMetricSnapshot(): AnalysisSnapshot {
  const snap = clone(SNAPSHOT);
  const metric = snap.metrics.find((m) => m.id === "june-margin");
  const proof = snap.provenance.find((p) => p.id === "june-margin-proof");
  if (metric === undefined || proof === undefined) throw new Error("fixture drifted");
  metric.status = "undefined";
  metric.value = null;
  metric.reasonKey = "coverage.partial";
  metric.warnings = ["limitations.contribution"];
  proof.status = "undefined";
  proof.result = null;
  proof.reasonKey = "coverage.partial";
  const finding: Finding = clone(BASE);
  finding.id = "finding-margin-demo";
  finding.titleKey = "finding.descriptive.title";
  finding.bodyKey = "finding.descriptive.body";
  finding.metricIds = ["june-margin", "june-revenue", "june-operating-cost"];
  finding.provenanceIds = ["june-margin-proof", "june-revenue-proof", "june-operating-cost-proof"];
  finding.qualityIssueIds = [];
  finding.rank = synthRank("0.4", "0.25");
  finding.limitations = ["limitations.contribution", "limitations.noForecast"];
  snap.findings.push(finding);
  return snap;
}

/** A sheet name that is long, mixed-direction, and must wrap inside the sheet line. */
function longSheetTable(): NormalizedTable {
  const table = clone(TABLE);
  table.sourceRef = {
    ...table.sourceRef,
    sheetName:
      "Operations — Eastern region ledger 2026 second-quarter consolidated " +
      "working sheet with daily reconciliation rows جدول العمليات الموحد",
  };
  return table;
}

export { MALICIOUS_STRINGS } from "./strings.ts";

function maliciousTable(): NormalizedTable {
  const table = clone(TABLE);
  const rows = table.rows.filter((r) => r.sourceRow === 1802 || r.sourceRow === 1803);
  if (rows.length !== 2) throw new Error("fixture drifted — expected rows 1802/1803");
  const first = rows[0];
  const second = rows[1];
  if (first === undefined || second === undefined) throw new Error("fixture drifted");
  // The revenue column is what the selection browser renders — hostile text
  // there must stay text. (The sum legitimately goes undefined on non-decimal
  // input; the renderer's job is verbatim display.)
  first.values["revenue"] = MALICIOUS_SITE;
  second.values["revenue"] = MALICIOUS_ID;
  return table;
}

export interface ScenarioFixture {
  bundle: EvidenceBundle;
  /** Finding id inside the (possibly cloned) snapshot. */
  findingId: string;
}

export function scenarioFixture(name: EvidenceScenario): ScenarioFixture {
  switch (name) {
    case "revenue-gap":
      return { bundle: bundleFor("finding-north-target"), findingId: "finding-north-target" };
    case "quality":
      return { bundle: bundleFor("finding-quality"), findingId: "finding-quality" };
    case "undefined-metric": {
      const snapshot = undefinedMetricSnapshot();
      return { bundle: { snapshot, table: TABLE, findingId: "finding-margin-demo" }, findingId: "finding-margin-demo" };
    }
    case "disjoint": {
      const snapshot = disjointSnapshot();
      return { bundle: { snapshot, table: TABLE, findingId: "finding-disjoint-demo" }, findingId: "finding-disjoint-demo" };
    }
    case "long-sheet":
      return { bundle: bundleFor("finding-north-target", { table: longSheetTable() }), findingId: "finding-north-target" };
    case "malicious":
      return { bundle: bundleFor("finding-north-target", { table: maliciousTable() }), findingId: "finding-north-target" };
  }
}
