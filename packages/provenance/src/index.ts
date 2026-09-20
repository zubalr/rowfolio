/**
 * Public entry surface for `@rowfolio/provenance`.
 *
 * Only the contract-assigned signatures cross the package boundary:
 * `evaluateProof` recomputes a proof value from clean cells, and
 * `readEvidencePage` pages the contributing rows of a selection.
 * Span compression, selection validation and display helpers are exported
 * for testability; the arithmetic oracle itself stays in contracts.
 */
import type {
  EvaluateProof,
  ReadEvidencePage,
} from '@rowfolio/contracts/interfaces';
import { evaluateProof as evaluateProofImpl } from './proof.ts';
import { readEvidencePage as readEvidencePageImpl } from './evidence.ts';

export type { EvaluateProof, ReadEvidencePage };
export { evaluateProof, checkSelection, requireSelection } from './proof.ts';
export type { SelectionCheck } from './proof.ts';
export { ProofError } from './proof.ts';
export { readEvidencePage, evidenceRow, bidiIsolate } from './evidence.ts';
export type { EvidenceRow } from './evidence.ts';
export { MAX_EVIDENCE_PAGE } from './evidence.ts';
export {
  canonicalizeSpans,
  expandSpans,
  spanRowCount,
  validateSpans,
} from './spans.ts';
export type { SpanProblems } from './spans.ts';

export const evaluateProofApi: EvaluateProof = evaluateProofImpl;
export const readEvidencePageApi: ReadEvidencePage = readEvidencePageImpl;
