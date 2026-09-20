/**
 * Contract-level expression/proof evaluator: recomputes every metric's
 * stated value from the source-side Provenance graph, matching the
 * independent planning oracle (scripts/validate_contracts.py).
 *
 * All arithmetic is exact decimal (precision 40, ROUND_HALF_UP) via
 * `decimal.ts`; expression strings are never `eval`ed — the grammar is the
 * closed six-op Expression union. A metric referenced through a `metric` op
 * resolves through its own provenanceId (proof DAG), so cycles surface.
 */
import type { Expression, Metric, NormalizedRow, NormalizedTable, Provenance, QualityIssue, RowSelection } from './types.ts';
import { addDecimal, DecimalArithmeticError, divideDecimal, isDecimal, multiplyDecimal, subtractDecimal } from './decimal.ts';
import { issue, pointer, type ContractIssue } from './errors.ts';

export interface EvalContext {
  /** metric id → metric (merged snapshot + scenario namespace). */
  readonly metrics: ReadonlyMap<string, Metric>;
  /** proof id → provenance row. */
  readonly proofs: ReadonlyMap<string, Provenance>;
  /** selection id → { selection, physical source rows in span order }. */
  readonly selections: ReadonlyMap<string, { readonly selection: RowSelection; readonly rows: readonly number[] }>;
  /** physical source row → normalized row. */
  readonly rowsBySourceRow: ReadonlyMap<number, NormalizedRow>;
  /** quality issue id → issue (the ledger `count-issues` reads). */
  readonly issues: ReadonlyMap<string, QualityIssue>;
}

export type EvalOutcome =
  | { readonly status: 'defined'; readonly value: string }
  | { readonly status: 'undefined'; readonly rule: string; readonly detail: string };

const DEFINED = (value: string): EvalOutcome => ({ status: 'defined', value });
const UNDEFINED = (rule: string, detail: string): EvalOutcome => ({ status: 'undefined', rule, detail });

/** Expand canonical spans into physical source row numbers in order. */
export function selectionRows(selection: RowSelection): number[] {
  const rows: number[] = [];
  for (const span of selection.spans) {
    for (let n = span.start; n <= span.end; n += 1) rows.push(n);
  }
  return rows;
}

/**
 * Build the evaluation context for a document set. `table` supplies rows
 * and the quality ledger; metrics/proofs/selections come from one or more
 * analysis/scenario payloads (callers merge namespaces).
 */
export function buildEvalContext(
  table: NormalizedTable | null,
  metrics: readonly Metric[],
  proofs: readonly Provenance[],
): EvalContext {
  const metricMap = new Map<string, Metric>();
  for (const m of metrics) if (!metricMap.has(m.id)) metricMap.set(m.id, m);
  const proofMap = new Map<string, Provenance>();
  const selectionMap = new Map<string, { selection: RowSelection; rows: number[] }>();
  for (const p of proofs) {
    if (!proofMap.has(p.id)) proofMap.set(p.id, p);
    for (const s of p.selections) {
      if (!selectionMap.has(s.id)) selectionMap.set(s.id, { selection: s, rows: selectionRows(s) });
    }
  }
  const rowsBySourceRow = new Map<number, NormalizedRow>();
  const issues = new Map<string, QualityIssue>();
  if (table !== null) {
    for (const r of table.rows) if (!rowsBySourceRow.has(r.sourceRow)) rowsBySourceRow.set(r.sourceRow, r);
    for (const q of table.qualityIssues) if (!issues.has(q.id)) issues.set(q.id, q);
  }
  return { metrics: metricMap, proofs: proofMap, selections: selectionMap, rowsBySourceRow, issues };
}

class Evaluation {
  private readonly active = new Set<string>();
  private readonly cache = new Map<string, EvalOutcome>();

  constructor(
    private readonly ctx: EvalContext,
    private readonly issues: ContractIssue[],
    private readonly basePath: string,
  ) {}

  metric(metricId: string): EvalOutcome {
    const cached = this.cache.get(metricId);
    if (cached !== undefined) return cached;
    const metric = this.ctx.metrics.get(metricId);
    if (metric === undefined) {
      this.issues.push(issue('semantic', 'expression.metricId.missing', this.basePath, `metric ${JSON.stringify(metricId)} is not declared`));
      return UNDEFINED('metric.missing', metricId);
    }
    if (this.active.has(metricId)) {
      this.issues.push(issue('semantic', 'expression.cycle', this.basePath, `proof metric graph has a cycle through ${JSON.stringify(metricId)}`));
      return UNDEFINED('metric.cycle', metricId);
    }
    if (metric.status !== 'defined') {
      return UNDEFINED('metric.undefined', metricId); // propagated, not an issue per se
    }
    const proof = this.ctx.proofs.get(metric.provenanceId);
    if (proof === undefined) {
      this.issues.push(issue('semantic', 'metric.provenance.missing', this.basePath, `metric ${JSON.stringify(metricId)} references missing provenance ${JSON.stringify(metric.provenanceId)}`));
      return UNDEFINED('proof.missing', metric.provenanceId);
    }
    this.active.add(metricId);
    const outcome = this.expression(proof.expression, `${this.basePath} → ${metric.provenanceId}`);
    this.active.delete(metricId);
    this.cache.set(metricId, outcome);
    return outcome;
  }

  expression(expr: Expression, path: string): EvalOutcome {
    switch (expr.op) {
      case 'literal': {
        if (!isDecimal(expr.value)) {
          this.issues.push(issue('decimal', 'expression.literal', path, `literal ${JSON.stringify(expr.value)} is not a safe canonical decimal`));
          return UNDEFINED('literal.invalid', expr.value);
        }
        return DEFINED(expr.value);
      }
      case 'metric':
        return this.metric(expr.metricId);
      case 'sum': {
        const entry = this.ctx.selections.get(expr.selectionId);
        if (entry === undefined) {
          this.issues.push(issue('semantic', 'expression.selectionId.missing', path, `sum references unknown selection ${JSON.stringify(expr.selectionId)}`));
          return UNDEFINED('selection.missing', expr.selectionId);
        }
        if (!entry.selection.fieldIds.includes(expr.fieldId)) {
          this.issues.push(issue('semantic', 'expression.fieldId', path, `sum field ${JSON.stringify(expr.fieldId)} is not in selection ${JSON.stringify(expr.selectionId)} fieldIds`));
          return UNDEFINED('fieldId.missing', expr.fieldId);
        }
        let acc = '0';
        for (const n of entry.rows) {
          const row = this.ctx.rowsBySourceRow.get(n);
          if (row === undefined) {
            this.issues.push(issue('semantic', 'selection.row.missing', path, `selection ${JSON.stringify(expr.selectionId)} references absent source row ${n}`));
            return UNDEFINED('row.missing', String(n));
          }
          const v = row.values[expr.fieldId];
          if (typeof v !== 'string' || !isDecimal(v)) {
            this.issues.push(issue('decimal', 'selection.value.notDecimal', path, `row ${row.id} field ${JSON.stringify(expr.fieldId)} is not a finite decimal`));
            return UNDEFINED('operand.notDecimal', `${row.id}.${expr.fieldId}`);
          }
          acc = addDecimal(acc, v);
        }
        return DEFINED(acc);
      }
      case 'count-rows': {
        const entry = this.ctx.selections.get(expr.selectionId);
        if (entry === undefined) {
          this.issues.push(issue('semantic', 'expression.selectionId.missing', path, `count-rows references unknown selection ${JSON.stringify(expr.selectionId)}`));
          return UNDEFINED('selection.missing', expr.selectionId);
        }
        return DEFINED(String(entry.rows.length));
      }
      case 'count-issues': {
        const seen = new Set<string>();
        for (const id of expr.issueIds) {
          if (seen.has(id)) {
            this.issues.push(issue('semantic', 'expression.issueIds.duplicate', path, `count-issues repeats ${JSON.stringify(id)}`));
            return UNDEFINED('issueIds.duplicate', id);
          }
          seen.add(id);
          if (!this.ctx.issues.has(id)) {
            this.issues.push(issue('semantic', 'expression.issueIds.missing', path, `count-issues references unknown issue ${JSON.stringify(id)}`));
            return UNDEFINED('issueIds.missing', id);
          }
        }
        return DEFINED(String(expr.issueIds.length));
      }
      case 'add':
      case 'subtract':
      case 'multiply':
      case 'divide': {
        const left = this.expression(expr.left, pointer(path, 'left'));
        const right = this.expression(expr.right, pointer(path, 'right'));
        if (left.status === 'undefined') return left;
        if (right.status === 'undefined') return right;
        try {
          switch (expr.op) {
            case 'add':
              return DEFINED(addDecimal(left.value, right.value));
            case 'subtract':
              return DEFINED(subtractDecimal(left.value, right.value));
            case 'multiply':
              return DEFINED(multiplyDecimal(left.value, right.value));
            case 'divide':
              return DEFINED(divideDecimal(left.value, right.value));
          }
        } catch (e) {
          if (e instanceof DecimalArithmeticError && e.rule === 'divide-by-zero') {
            return UNDEFINED('divideByZero', `${left.value} / ${right.value}`);
          }
          throw e;
        }
      }
    }
  }
}

/**
 * Recompute a metric through its provenance graph. Semantic issues found
 * while evaluating (dangling refs, non-decimal operands, cycles) are
 * appended to `issues`.
 */
export function evaluateMetric(metricId: string, ctx: EvalContext, issues: ContractIssue[], path = ''): EvalOutcome {
  return new Evaluation(ctx, issues, path).metric(metricId);
}
