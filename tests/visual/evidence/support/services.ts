/**
 * Reference provenance adapter for the evidence harness/tests.
 *
 * Binds the real @rowfolio/provenance implementations (`evaluateProof`,
 * `readEvidencePage`) to the app-side `EvidenceServices` injection seam. No
 * stubbed values: every result is recomputed from the fixture table by the
 * provenance package itself; `contextProofs` defaults to the finding's proofs
 * so composite expressions resolve their siblings.
 *
 * tests/* is not a pnpm workspace member, so the package is reached by
 * relative path (same convention as tests/contract).
 */
import {
  evaluateProof,
  readEvidencePage,
} from "../../../../packages/provenance/src/index.ts";
import type { NormalizedTable, Provenance } from "../../../../packages/contracts/src/index.ts";
import type { EvidenceServices } from "../../../../apps/web/src/evidence/index.ts";

export function referenceServices(
  _table: NormalizedTable,
  proofs: readonly Provenance[],
): EvidenceServices {
  return {
    evaluateProof: (proof, table, metrics, contextProofs) =>
      evaluateProof(proof, table, metrics, contextProofs ?? proofs),
    readEvidencePage,
  };
}
