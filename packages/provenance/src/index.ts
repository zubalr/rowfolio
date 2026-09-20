/**
 * Public entry surface for `@rowfolio/provenance`.
 *
 * `evaluateProof` recomputes a proof value from clean cells, and
 * `readEvidencePage` pages the contributing rows of a selection.
 * Span compression, selection validation and display helpers are exported
 * for testability; the arithmetic oracle itself stays in contracts.
 */
export { evaluateProof, checkSelection, requireSelection } from './proof.ts';
export type { SelectionCheck } from './proof.ts';
export { ProofError } from './proof.ts';
export { readEvidencePage, evidenceRow, bidiIsolate } from './evidence.ts';
export type { EvidencePage, EvidenceRow } from './evidence.ts';
export { MAX_EVIDENCE_PAGE } from './evidence.ts';
export {
  canonicalizeSpans,
  expandSpans,
  spanRowCount,
  validateSpans,
} from './spans.ts';
export type { SpanProblems } from './spans.ts';
export { SpanError } from './spans.ts';
export { MAX_EXPANDED_ROWS } from './spans.ts';
