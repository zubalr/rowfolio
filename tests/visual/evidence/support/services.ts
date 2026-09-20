/**
 * Reference provenance adapter for the evidence harness/tests.
 *
 * Implements the mirrored `EvidenceServices` surface (the INTERFACES.md v1.0.0
 * `evaluateProof`/`readEvidencePage` signatures) on top of the real contracts
 * evaluator — `buildEvalContext` + `evaluateMetric` do exact-decimal
 * recomputation and `selectionRows` expands canonical spans. No stubbed values:
 * every result is computed from the fixture table through the same oracle the
 * contract suite reconciles against.
 *
 * Tests/ are exempt from the app-source deep-import ban, so this file binds the
 * app-side `EvidenceServices` type directly to prove the injection seam.
 */
import {
  buildEvalContext,
  evaluateMetric,
  selectionRows,
  type ContractIssue,
  type NormalizedRow,
  type NormalizedTable,
  type Provenance,
} from "../../../../packages/contracts/src/index.ts";
import type { EvidenceServices } from "../../../../apps/web/src/evidence/index.ts";

export function referenceServices(
  table: NormalizedTable,
  proofs: readonly Provenance[],
): EvidenceServices {
  return {
    evaluateProof(proof, tableArg, metrics) {
      const owner = metrics.find((m) => m.provenanceId === proof.id);
      // No owning metric → the proof cannot be recomputed; surface its stored
      // result verbatim (the panel still marks it against evaluate output).
      if (owner === undefined) {
        return { value: proof.result, reasonKey: proof.reasonKey };
      }
      const issues: ContractIssue[] = [];
      const ctx = buildEvalContext(tableArg, metrics, proofs);
      const out = evaluateMetric(owner.id, ctx, issues);
      if (out.status === "defined") return { value: out.value, reasonKey: null };
      // EvalOutcome.rule is a diagnostic code, not a copy key — the localized
      // reason lives on the proof itself.
      return { value: null, reasonKey: proof.reasonKey };
    },
    readEvidencePage(tableArg, selection, offset, pageSize) {
      const rowsBySourceRow = new Map<number, NormalizedRow>(
        tableArg.rows.map((r) => [r.sourceRow, r]),
      );
      // Eligible = inside the canonical spans and still present in the table
      // (excluded rows were removed by the ledger, never silently re-added).
      const eligible = selectionRows(selection)
        .map((n) => rowsBySourceRow.get(n))
        .filter((r): r is NormalizedRow => r !== undefined);
      const rows = eligible.slice(offset, offset + pageSize);
      const nextOffset = offset + pageSize < eligible.length ? offset + pageSize : null;
      return { rows, offset, total: eligible.length, nextOffset };
    },
  };
}
