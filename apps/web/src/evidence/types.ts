/**
 * Evidence dialog + source browser — public types.
 *
 * The evidence surface renders ONLY Provenance-service output: proofs, their
 * resolved metrics/selections/issues and paged source rows. No arithmetic is
 * duplicated here — `evaluateProof` / `readEvidencePage` are injected with the
 * exact signatures INTERFACES.md v1.0.0 assigns to packages/provenance (mirrored
 * below verbatim until @rowfolio/contracts re-exports src/interfaces.ts at the
 * package root — ESLint forbids the deep `@rowfolio/contracts/interfaces`
 * specifier in app source).
 */
import type {
  AnalysisSnapshot,
  Decimal,
  Finding,
  Metric,
  NormalizedRow,
  NormalizedTable,
  Provenance,
  RowSelection,
} from "@rowfolio/contracts";

/** Contract version this UI binds to. */
export const EVIDENCE_CONTRACT_VERSION = "1.0.0" as const;

/** Rows fetched per page — 04_DESIGN_SYSTEM.md: "Tables are secondary, 50 rows per page". */
export const EVIDENCE_PAGE_SIZE = 50;

/** packages/provenance — INTERFACES.md §"Package entry points". */
export type EvaluateProof = (
  proof: Provenance,
  table: NormalizedTable,
  metrics: readonly Metric[],
) => { value: Decimal | null; reasonKey: string | null };

export interface EvidencePage {
  rows: readonly NormalizedRow[];
  offset: number;
  total: number;
  nextOffset: number | null;
}

export type ReadEvidencePage = (
  table: NormalizedTable,
  selection: RowSelection,
  offset: number,
  pageSize: number,
) => EvidencePage;

/** Injected provenance service — the sole numeric truth for this surface. */
export interface EvidenceServices {
  evaluateProof: EvaluateProof;
  readEvidencePage: ReadEvidencePage;
}

/** The immutable inputs the dialog needs — everything is contract-shaped. */
export interface EvidenceBundle {
  snapshot: AnalysisSnapshot;
  table: NormalizedTable;
  findingId: string;
}

/** A resolved finding with its ordered metrics and proofs. */
export interface EvidenceSubject {
  finding: Finding;
  /** `finding.metricIds` resolved, declaration order preserved. */
  metrics: readonly Metric[];
  /** `finding.provenanceIds` resolved, declaration order preserved. */
  proofs: readonly Provenance[];
}

export type EvidenceErrorCode =
  /** findingId absent from the snapshot */
  | "evidence.finding.missing"
  /** a declared metric/provenance reference does not resolve */
  | "evidence.reference.missing";

/** Typed error for contract-graph resolution failures (never swallowed). */
export class EvidenceError extends Error {
  readonly code: EvidenceErrorCode;
  readonly detail: string;

  constructor(code: EvidenceErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "EvidenceError";
    this.code = code;
    this.detail = detail;
  }
}
