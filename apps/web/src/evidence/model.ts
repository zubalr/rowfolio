/**
 * Pure view-model helpers for the evidence surface.
 *
 * Everything here is graph navigation and presentation shaping over contract
 * objects — no metric arithmetic. Display strings that need a locale are built
 * from the injected `I18n` so formatting stays in the i18n layer.
 */
import {
  isDecimal,
  normalizeDecimalString,
  type Expression,
  type Metric,
  type NormalizedTable,
  type Provenance,
  type QualityIssue,
  type RowSelection,
  type Scope,
} from "@rowfolio/contracts";
import type { I18n, MessageKey } from "@rowfolio/i18n";
import {
  EvidenceError,
  type EvidenceBundle,
  type EvidenceSubject,
} from "./types.ts";

/** Resolve bundle references into an ordered subject; dangling refs are typed errors. */
export function resolveEvidenceSubject(bundle: EvidenceBundle): EvidenceSubject {
  const { snapshot, findingId } = bundle;
  const finding = snapshot.findings.find((f) => f.id === findingId);
  if (finding === undefined) {
    throw new EvidenceError("evidence.finding.missing", findingId);
  }
  const metricById = new Map(snapshot.metrics.map((m) => [m.id, m]));
  const proofById = new Map(snapshot.provenance.map((p) => [p.id, p]));
  const metrics = finding.metricIds.map((id) => {
    const m = metricById.get(id);
    if (m === undefined) throw new EvidenceError("evidence.reference.missing", `metric ${id}`);
    return m;
  });
  const proofs = finding.provenanceIds.map((id) => {
    const p = proofById.get(id);
    if (p === undefined) throw new EvidenceError("evidence.reference.missing", `provenance ${id}`);
    return p;
  });
  return { finding, metrics, proofs };
}

/** The metric that publishes this proof (metrics own provenance by `provenanceId`). */
export function metricForProof(metrics: readonly Metric[], proofId: string): Metric | undefined {
  return metrics.find((m) => m.provenanceId === proofId);
}

/**
 * Every distinct selection referenced anywhere in the subject's proofs,
 * first-seen order. Selections are shared between proofs — the surface must
 * show each physical selection once, never one block per reference.
 */
export function subjectSelections(subject: EvidenceSubject): RowSelection[] {
  const seen = new Set<string>();
  const out: RowSelection[] = [];
  for (const proof of subject.proofs) {
    for (const sel of proof.selections) {
      if (!seen.has(sel.id)) {
        seen.add(sel.id);
        out.push(sel);
      }
    }
  }
  return out;
}

/** Union of every transformId carried by the subject's proofs, order-stable. */
export function subjectTransformIds(subject: EvidenceSubject): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const proof of subject.proofs) {
    for (const id of proof.transformIds) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * Ordered, disjoint, nonadjacent canonical spans rendered as exact tokens —
 * `R2–R4 · R9`, never collapsed into a misleading `R2–R9` that sweeps up
 * non-contributing rows.
 */
export function spanTokens(selection: RowSelection): string[] {
  return selection.spans.map((span) =>
    span.start === span.end ? `R${span.start}` : `R${span.start}-R${span.end}`,
  );
}

/** Expand canonical spans to the physical source-row list (read-only; used for lookups, not sums). */
export function selectionRowNumbers(selection: RowSelection): number[] {
  const rows: number[] = [];
  for (const span of selection.spans) {
    for (let n = span.start; n <= span.end; n += 1) rows.push(n);
  }
  return rows;
}

/** `S0:R2402` → 2402. Row IDs bind sheet ordinal + physical row; never a display index. */
export function rowIdToSourceRow(id: string): number | null {
  const m = /^S(\d+):R(\d+)$/.exec(id);
  return m === null ? null : Number(m[2]);
}

/** Cell-level change ledger: `sourceRow:fieldId` → issues touching that cell. */
export function issuesByCell(table: NormalizedTable): Map<string, QualityIssue[]> {
  const map = new Map<string, QualityIssue[]>();
  for (const q of table.qualityIssues) {
    if (q.fieldId === null) continue;
    const key = `${q.sourceRow}:${q.fieldId}`;
    const list = map.get(key);
    if (list === undefined) map.set(key, [q]);
    else list.push(q);
  }
  return map;
}

/** Ledger entries whose physical row lies inside the selection's spans. */
export function issuesInSelection(selection: RowSelection, table: NormalizedTable): QualityIssue[] {
  const inSpans = new Set(selectionRowNumbers(selection));
  return table.qualityIssues.filter((q) => inSpans.has(q.sourceRow));
}

/** Unresolved/proposed issues still visible inside a selection — the missing/cache caveats. */
export function openIssuesInSelection(selection: RowSelection, table: NormalizedTable): QualityIssue[] {
  return issuesInSelection(selection, table).filter(
    (q) => q.status === "unresolved" || q.status === "proposed",
  );
}

/** A caveat attached to a specific rendered value (warnings sit beside their value). */
export interface EvidenceCaveat {
  /** Stable element key. */
  id: string;
  /** Catalog message key — rendered through tSafe, so an unknown key degrades safely. */
  messageKey: string;
  tone: "info" | "warning";
}

/** Caveats that travel with one metric's displayed value. */
export function metricCaveats(metric: Metric): EvidenceCaveat[] {
  const out: EvidenceCaveat[] = [];
  if (metric.status === "undefined" && metric.reasonKey !== null) {
    out.push({ id: `${metric.id}:reason`, messageKey: metric.reasonKey, tone: "warning" });
  }
  for (const key of metric.warnings) {
    out.push({ id: `${metric.id}:warn:${key}`, messageKey: key, tone: "info" });
  }
  return out;
}

/** Scope-level caveats for the subject header (partial coverage, finding limitations). */
export function subjectCaveats(subject: EvidenceSubject): EvidenceCaveat[] {
  const out: EvidenceCaveat[] = [];
  if (!subject.finding.scope.complete) {
    out.push({ id: "scope-partial", messageKey: subject.finding.scope.coverageNoteKey, tone: "warning" });
  }
  for (const key of subject.finding.limitations) {
    out.push({ id: `limitation:${key}`, messageKey: key, tone: "info" });
  }
  return out;
}

/**
 * Selection-level caveats: unresolved quality issues (missing values, stale
 * formula caches) inside the contributing span, named per the ledger.
 */
export function selectionCaveats(selection: RowSelection, table: NormalizedTable): EvidenceCaveat[] {
  const out: EvidenceCaveat[] = [];
  const open = openIssuesInSelection(selection, table);
  if (open.some((q) => q.kind === "missing" || q.kind === "malformed")) {
    out.push({ id: `${selection.id}:missing`, messageKey: "limitations.missingRetained", tone: "info" });
  }
  if (open.some((q) => q.kind === "formula-cache")) {
    out.push({ id: `${selection.id}:cache`, messageKey: "limitations.cache", tone: "info" });
  }
  if (out.length === 0 && open.length > 0) {
    out.push({ id: `${selection.id}:open`, messageKey: "quality.unresolved", tone: "info" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Locale-facing formatting (the only place numbers become display strings)
// ---------------------------------------------------------------------------

/** Human-readable scope line: period range, regions, coverage note. */
export function formatScope(i18n: I18n, scope: Scope): string {
  const parts: string[] = [];
  if (scope.periodStart !== null && scope.periodEnd !== null) {
    parts.push(i18n.formatDateRange(scope.periodStart, scope.periodEnd));
  }
  if (scope.regions.length > 0) {
    const localized = scope.regions.map((r) => {
      const key = `region.${r}` as MessageKey;
      return i18n.has(key) ? i18n.t(key) : r; // region names are user content — verbatim fallback
    });
    parts.push(i18n.formatList(localized));
  }
  parts.push(i18n.tSafe(scope.coverageNoteKey as MessageKey));
  return parts.join(" · ");
}

/**
 * Decimal → localized display string by the metric's unit. Raw decimal strings
 * are rendered by the i18n formatters only; this layer never recomputes or
 * re-rounds them.
 */
export function formatDecimalForUnit(i18n: I18n, value: string, unitKind: string): string {
  if (unitKind === "ratio" || unitKind === "percentage-point") return i18n.formatPercent(value);
  return i18n.formatNumber(value);
}

export function formatMetricValue(i18n: I18n, metric: Metric): string | null {
  if (metric.status !== "defined" || metric.value === null) return null;
  if (metric.unit.kind === "currency" && metric.unit.currency !== null) {
    return i18n.formatCurrency(metric.value, metric.unit.currency);
  }
  return formatDecimalForUnit(i18n, metric.value, metric.unit.kind);
}

/** Same formatter for a bare proof result — units come from the owning metric. */
export function formatProofResult(i18n: I18n, proof: Provenance, metrics: readonly Metric[]): string | null {
  const evaluated = proof.result;
  if (evaluated === null || !isDecimal(evaluated)) return null;
  const owner = metricForProof(metrics, proof.id);
  if (owner !== undefined) return formatMetricValue(i18n, { ...owner, value: evaluated });
  return i18n.formatNumber(evaluated);
}

/** Exact-vs-stored reconciliation: canonical decimal equality, scale-tolerant. */
export function resultsAgree(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  if (!isDecimal(a) || !isDecimal(b)) return false;
  return normalizeDecimalString(a) === normalizeDecimalString(b);
}

/**
 * Operand references appearing inside an expression tree — used to render the
 * "contributing values" list and to let a trace node resolve its operand.
 */
export interface ExpressionOperands {
  metricIds: string[];
  selectionIds: string[];
  issueIds: string[];
  literals: string[];
}

export function expressionOperands(expr: Expression): ExpressionOperands {
  const metricIds: string[] = [];
  const selectionIds: string[] = [];
  const issueIds: string[] = [];
  const literals: string[] = [];
  const visit = (node: Expression): void => {
    switch (node.op) {
      case "literal":
        literals.push(node.value);
        break;
      case "metric":
        metricIds.push(node.metricId);
        break;
      case "sum":
        selectionIds.push(node.selectionId);
        break;
      case "count-rows":
        selectionIds.push(node.selectionId);
        break;
      case "count-issues":
        issueIds.push(...node.issueIds);
        break;
      case "add":
      case "subtract":
      case "multiply":
      case "divide":
        visit(node.left);
        visit(node.right);
        break;
    }
  };
  visit(expr);
  return { metricIds, selectionIds, issueIds, literals };
}
