/**
 * Evidence dialog + source browser — public types.
 *
 * The evidence surface renders ONLY Provenance-service output: proofs, their
 * resolved metrics/selections/issues and paged source rows. No arithmetic is
 * duplicated here — `evaluateProof` / `readEvidencePage` are injected with the
 * exact signatures @rowfolio/provenance exports (the service types below are
 * `typeof` the real functions, so the package's own implementations assign
 * directly to the seam).
 */
import type {
  EvidencePage as ProvenanceEvidencePage,
  evaluateProof as provenanceEvaluateProof,
  readEvidencePage as provenanceReadEvidencePage,
} from "@rowfolio/provenance";
import type {
  AnalysisSnapshot,
  Finding,
  Metric,
  NormalizedTable,
  Provenance,
} from "@rowfolio/contracts";

/** Contract version this UI binds to. */
export const EVIDENCE_CONTRACT_VERSION = "1.0.0" as const;

/** Rows fetched per page — 04_DESIGN_SYSTEM.md: "Tables are secondary, 50 rows per page". */
export const EVIDENCE_PAGE_SIZE = 50;

/**
 * @rowfolio/provenance — INTERFACES.md §"Package entry points". `contextProofs`
 * carries the finding's sibling proofs so composite expressions (e.g. a gap
 * metric referencing other proofs) resolve instead of reporting `proof.missing`.
 */
export type EvaluateProof = typeof provenanceEvaluateProof;

export type EvidencePage = ProvenanceEvidencePage;

export type ReadEvidencePage = typeof provenanceReadEvidencePage;

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
