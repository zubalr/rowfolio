/**
 * Proof evaluation over the contract's deterministic oracle.
 *
 * Arithmetic lives in `@rowfolio/contracts` (exact decimal, closed
 * expression grammar, cycle detection); this package contributes the
 * contract-assigned `evaluateProof` entry point plus selection validation
 * against a concrete normalized table. Expression strings are never
 * evaluated — the grammar is the closed six-op union.
 */
import {
  buildEvalContext,
  evaluateMetric,
  type ContractIssue,
  type Decimal,
  type Metric,
  type NormalizedTable,
  type Provenance,
  type RowSelection,
} from '@rowfolio/contracts';
import { expandSpans, validateSpans } from './spans.ts';

export class ProofError extends Error {
  readonly code: 'unknown-selection' | 'unknown-metric' | 'invalid-selection' | 'invalid-page';
  constructor(code: ProofError['code'], message: string) {
    super(message);
    this.name = 'ProofError';
    this.code = code;
  }
}

const SYNTHETIC_METRIC = '__proof_under_evaluation__';

/**
 * Evaluate a proof's expression against clean table cells.
 * Returns the recomputed value, or `{ value: null, reasonKey }` when the
 * proof is undefined (missing refs, non-decimal operands, cycles,
 * divide-by-zero) — never a thrown error for data conditions.
 *
 * `contextProofs` carries the sibling proofs a composite expression
 * resolves through (a gap proof references the revenue/target proofs);
 * without them, metric references report `proof.missing` instead of
 * silently falling back to stated values.
 */
export function evaluateProof(
  proof: Provenance,
  table: NormalizedTable,
  metrics: readonly Metric[],
  contextProofs: readonly Provenance[] = [],
): { value: Decimal | null; reasonKey: string | null } {
  const synthetic: Metric = {
    id: SYNTHETIC_METRIC,
    labelKey: 'evidence.calculation',
    value: null,
    status: 'defined',
    reasonKey: null,
    unit: { kind: 'unknown', label: 'unit', currency: null },
    scope: {
      tableId: table.id,
      periodStart: null,
      periodEnd: null,
      regions: [],
      complete: false,
      coverageNoteKey: 'evidence.title',
    },
    eligibleRows: 0,
    totalRows: 0,
    provenanceId: proof.id,
    warnings: [],
  };
  const issues: ContractIssue[] = [];
  const proofs = contextProofs.some((p) => p.id === proof.id) ? contextProofs : [proof, ...contextProofs];
  const ctx = buildEvalContext(table, [...metrics, synthetic], proofs);
  const outcome = evaluateMetric(SYNTHETIC_METRIC, ctx, issues, `/${proof.id}`);
  if (outcome.status === 'defined') return { value: outcome.value, reasonKey: null };
  return { value: null, reasonKey: outcome.rule };
}

export interface SelectionCheck {
  readonly valid: boolean;
  readonly problems: readonly string[];
  readonly contributingRows: readonly number[];
}

/**
 * Validate that a selection reconstructs its exact contributing set:
 * canonical spans, reconciled count, known source ref, every spanned row
 * present in the normalized table (excluded rows cannot contribute).
 */
export function checkSelection(
  selection: RowSelection,
  table: NormalizedTable,
): SelectionCheck {
  const problems: string[] = [];
  const spanCheck = validateSpans(selection.spans, selection.rowCount);
  if (!spanCheck.valid) problems.push(...spanCheck.problems);
  if (selection.sourceRefId !== table.sourceRef.id) {
    problems.push(`sourceRefId ${JSON.stringify(selection.sourceRefId)} does not match table source`);
  }
  const rowsBySource = new Map(table.rows.map((r) => [r.sourceRow, r.id] as const));
  const contributing = expandSpans(selection.spans);
  const missing = contributing.filter((n) => !rowsBySource.has(n));
  if (missing.length > 0) {
    problems.push(`selection references ${missing.length} absent source rows (e.g. ${missing.slice(0, 5).join(', ')})`);
  }
  return { valid: problems.length === 0, problems, contributingRows: contributing };
}

/**
 * Resolve a selection id from a proof set, throwing a typed error for
 * unknown ids instead of returning an empty page.
 */
export function requireSelection(proofs: readonly Provenance[], selectionId: string): RowSelection {
  for (const proof of proofs) {
    const found = proof.selections.find((s) => s.id === selectionId);
    if (found !== undefined) return found;
  }
  throw new ProofError('unknown-selection', `unknown selection ${JSON.stringify(selectionId)}`);
}
