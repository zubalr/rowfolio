/**
 * Mandatory semantic refinements beyond JSON Schema (INTERFACES.md
 * §"Semantic refinements"). The structural validator cannot express
 * referential integrity, canonical span order, status triples, decimal
 * safety, source-hash consistency or scenario bounds — those live here and
 * are as binding as the wire schema.
 *
 * Every `check*` returns a deterministic `ContractIssue[]` (empty = valid);
 * `assert*` throws `ContractError`. Context is optional: pass the related
 * normalized table/snapshot to enable cross-object checks — without it only
 * intra-document checks run.
 */
import type {
  AnalysisSnapshot,
  ChartSpec,
  Column,
  ExportModel,
  Finding,
  Metric,
  NormalizedRow,
  NormalizedTable,
  Provenance,
  RawTable,
  RowSelection,
  SampleManifest,
  ScenarioDefinition,
  ScenarioResult,
  Scope,
  SourceRef,
  Unit,
  WorkerRequest,
  WorkerResponse,
} from './types.ts';
import { checkSchema } from './registry.ts';
import { ContractError, issue, pointer, type ContractIssue, type ValidationResult } from './errors.ts';
import { deepEqual, isPlainObject, isValidDate } from './validator.ts';
import {
  compareDecimal,
  isDecimal,
  isIntegerDecimal,
  isMultipleOfStep,
  significantDigits,
} from './decimal.ts';
import { buildEvalContext, evaluateMetric, selectionRows, type EvalContext } from './evaluate.ts';
import { POLICY } from './policy.ts';
import { isTranslationKey } from './keys.ts';

export interface SemanticContext {
  /** The normalized table the payload describes (enables row/ledger/hash checks). */
  readonly table?: NormalizedTable;
  /** The baseline snapshot (required for scenario checks, used for export checks). */
  readonly snapshot?: AnalysisSnapshot;
  /** The scenario result (used when validating an export model that embeds it). */
  readonly scenario?: ScenarioResult;
  /** The scenario definition (validates scenario payloads against the fixed recipe). */
  readonly definition?: ScenarioDefinition;
  /** SHA-256 of the original source bytes, when the caller has them. */
  readonly sourceHash?: string;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function uniqueIds(items: readonly { id: string }[], what: string, path: string, issues: ContractIssue[]): Map<string, number> {
  const seen = new Map<string, number>();
  items.forEach((item, i) => {
    const prev = seen.get(item.id);
    if (prev !== undefined) {
      issues.push(issue('semantic', 'id.unique', pointer(path, i), `duplicate ${what} id ${JSON.stringify(item.id)} (first at index ${prev})`));
    } else {
      seen.set(item.id, i);
    }
  });
  return seen;
}

/** status/value/reasonKey coherence: defined ⇒ finite decimal & null reason; undefined ⇒ null value & reason key. */
function checkStatusTriple(
  status: 'defined' | 'undefined' | string,
  value: string | null,
  reasonKey: string | null,
  path: string,
  issues: ContractIssue[],
): void {
  if (status === 'defined') {
    if (value === null || !isDecimal(value)) {
      issues.push(issue('decimal', 'status.defined.value', pointer(path, 'value'), 'status "defined" requires a finite decimal value'));
    }
    if (reasonKey !== null) {
      issues.push(issue('semantic', 'status.defined.reason', pointer(path, 'reasonKey'), 'status "defined" requires reasonKey null'));
    }
  } else if (status === 'undefined') {
    if (value !== null) {
      issues.push(issue('semantic', 'status.undefined.value', pointer(path, 'value'), 'status "undefined" requires value null'));
    }
    if (typeof reasonKey !== 'string' || reasonKey.length === 0) {
      issues.push(issue('semantic', 'status.undefined.reason', pointer(path, 'reasonKey'), 'status "undefined" requires a non-empty reasonKey'));
    }
  }
}

/** ISO-4217 check against the platform Intl registry — three letters alone do not make a currency. */
export function isSupportedCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().currency === code;
  } catch {
    return false;
  }
}

function checkUnit(unit: Unit, path: string, issues: ContractIssue[]): void {
  if (unit.kind === 'currency') {
    if (unit.currency === null) {
      issues.push(issue('semantic', 'unit.currency.missing', pointer(path, 'currency'), 'kind "currency" requires a currency code'));
    } else if (!isSupportedCurrency(unit.currency)) {
      issues.push(issue('semantic', 'unit.currency.unsupported', pointer(path, 'currency'), `${JSON.stringify(unit.currency)} is not a supported ISO-4217 currency`));
    }
  }
}

function checkScope(scope: Scope, path: string, issues: ContractIssue[]): void {
  const { periodStart, periodEnd } = scope;
  if (periodStart === null && periodEnd === null) return;
  if (periodStart === null || periodEnd === null) {
    issues.push(issue('semantic', 'scope.period.half', path, 'periodStart and periodEnd must be both set or both null'));
    return;
  }
  if (!isValidDate(periodStart)) issues.push(issue('semantic', 'scope.period.date', pointer(path, 'periodStart'), 'not a real Gregorian date'));
  if (!isValidDate(periodEnd)) issues.push(issue('semantic', 'scope.period.date', pointer(path, 'periodEnd'), 'not a real Gregorian date'));
  if (isValidDate(periodStart) && isValidDate(periodEnd) && periodStart > periodEnd) {
    issues.push(issue('semantic', 'scope.period.order', path, `periodStart ${periodStart} is after periodEnd ${periodEnd}`));
  }
}

function checkSourceRef(ref: SourceRef, path: string, issues: ContractIssue[]): void {
  const { range, headerRow } = ref;
  if (range.firstRow > range.lastRow) issues.push(issue('semantic', 'range.order', pointer(path, 'range'), 'firstRow > lastRow'));
  if (range.firstColumn > range.lastColumn) issues.push(issue('semantic', 'range.order', pointer(path, 'range'), 'firstColumn > lastColumn'));
  if (headerRow < range.firstRow || headerRow > range.lastRow) {
    issues.push(issue('semantic', 'range.headerRow', pointer(path, 'headerRow'), 'headerRow outside the selected source range'));
  }
}

function rowId(sheetId: string, sourceRow: number): string {
  return `${sheetId}:R${sourceRow}`;
}

/**
 * Canonical span check: sorted ascending, disjoint AND non-adjacent
 * (`start > previousEnd + 1`), `start ≤ end`, and total length equal to
 * rowCount. Returns the physical rows in order, or null on violation.
 */
function checkSpans(selection: RowSelection, path: string, issues: ContractIssue[]): number[] | null {
  let ok = true;
  let last = 0;
  for (const [i, span] of selection.spans.entries()) {
    const p = pointer(pointer(path, 'spans'), i);
    if (span.start > span.end) {
      issues.push(issue('semantic', 'rowSpan.order', p, `span start ${span.start} > end ${span.end}`));
      ok = false;
    }
    if (span.start <= last + 1) {
      issues.push(issue('semantic', 'rowSpan.canonical', p, `span start ${span.start} overlaps or is adjacent to previous end ${last} — spans must be sorted, disjoint, non-adjacent`));
      ok = false;
    }
    if (span.end > last) last = span.end;
  }
  const rows = selectionRows(selection);
  if (rows.length !== selection.rowCount) {
    issues.push(issue('semantic', 'rowSpan.count', pointer(path, 'rowCount'), `rowCount ${selection.rowCount} ≠ ${rows.length} rows covered by spans`));
    ok = false;
  }
  return ok ? rows : null;
}

function checkSelection(
  selection: RowSelection,
  path: string,
  issues: ContractIssue[],
  ctx: { sourceRefIds: ReadonlySet<string>; sheetId: string | null; columnIds: ReadonlySet<string> | null; rowsBySourceRow: ReadonlyMap<number, NormalizedRow> | null },
): void {
  const rows = checkSpans(selection, path, issues);
  if (!ctx.sourceRefIds.has(selection.sourceRefId)) {
    issues.push(issue('semantic', 'selection.sourceRef', pointer(path, 'sourceRefId'), `unknown sourceRef ${JSON.stringify(selection.sourceRefId)}`));
  }
  const rowIdSet = new Set<string>();
  if (rows !== null && ctx.sheetId !== null) {
    for (const n of rows) rowIdSet.add(rowId(ctx.sheetId, n));
  }
  for (const [i, ex] of selection.excludedRowIds.entries()) {
    const p = pointer(pointer(path, 'excludedRowIds'), i);
    if (ctx.sheetId !== null) {
      const prefix = `${ctx.sheetId}:R`;
      const rest = ex.startsWith(prefix) ? ex.slice(prefix.length) : null;
      if (rest === null || !/^\d+$/.test(rest)) {
        issues.push(issue('semantic', 'selection.exclusion.id', p, `excluded id ${JSON.stringify(ex)} is not bound to sheet ${ctx.sheetId}`));
      }
    }
    if (rowIdSet.has(ex)) {
      issues.push(issue('semantic', 'selection.exclusion.contributing', p, `excluded row ${JSON.stringify(ex)} also contributes to the selection`));
    }
  }
  if (ctx.columnIds !== null) {
    for (const f of selection.fieldIds) {
      if (!ctx.columnIds.has(f)) issues.push(issue('semantic', 'selection.fieldId', pointer(path, 'fieldIds'), `unknown field/column ${JSON.stringify(f)}`));
    }
  }
  if (ctx.rowsBySourceRow !== null && rows !== null) {
    for (const n of rows) {
      if (!ctx.rowsBySourceRow.has(n)) {
        issues.push(issue('semantic', 'selection.row.missing', path, `selected source row ${n} is not in the normalized table`));
        break;
      }
    }
  }
}

/** Expression reference resolution (selection/metric/issue ids exist). Evaluation itself is in evaluate.ts. */
function checkExpressionRefs(
  expr: unknown,
  path: string,
  issues: ContractIssue[],
  pools: { selections: ReadonlySet<string>; metrics: ReadonlySet<string>; issues: ReadonlySet<string> },
): void {
  if (!isPlainObject(expr)) return;
  const op = expr['op'];
  if (op === 'sum') {
    if (typeof expr['selectionId'] === 'string' && !pools.selections.has(expr['selectionId'] as string)) {
      issues.push(issue('semantic', 'expression.selectionId.missing', pointer(path, 'selectionId'), `unknown selection ${JSON.stringify(expr['selectionId'])}`));
    }
  } else if (op === 'count-rows') {
    if (typeof expr['selectionId'] === 'string' && !pools.selections.has(expr['selectionId'] as string)) {
      issues.push(issue('semantic', 'expression.selectionId.missing', pointer(path, 'selectionId'), `unknown selection ${JSON.stringify(expr['selectionId'])}`));
    }
  } else if (op === 'metric') {
    if (typeof expr['metricId'] === 'string' && !pools.metrics.has(expr['metricId'] as string)) {
      issues.push(issue('semantic', 'expression.metricId.missing', pointer(path, 'metricId'), `unknown metric ${JSON.stringify(expr['metricId'])}`));
    }
  } else if (op === 'count-issues' && Array.isArray(expr['issueIds'])) {
    for (const id of expr['issueIds'] as string[]) {
      if (!pools.issues.has(id)) issues.push(issue('semantic', 'expression.issueIds.missing', path, `unknown quality issue ${JSON.stringify(id)}`));
    }
  }
  for (const k of ['left', 'right'] as const) {
    if (k in expr) checkExpressionRefs(expr[k], pointer(path, k), issues, pools);
  }
}

/** Every `*Key` string property anywhere in the payload must name a declared translation key. */
function checkKeyFields(value: unknown, path: string, issues: ContractIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkKeyFields(v, pointer(path, i), issues));
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k.endsWith('Key') && typeof v === 'string' && !isTranslationKey(v)) {
        issues.push(issue('semantic', 'key.manifest', pointer(path, k), `${JSON.stringify(v)} is not a declared translation key`));
      }
      checkKeyFields(v, pointer(path, k), issues);
    }
  }
}

// ---------------------------------------------------------------------------
// NormalizedTable
// ---------------------------------------------------------------------------

export function checkNormalizedTable(value: unknown, ctx: SemanticContext = {}): ContractIssue[] {
  const issues = checkSchema('NormalizedTable', value);
  if (issues.length > 0 || !isPlainObject(value)) return issues;
  const table = value as unknown as NormalizedTable;
  checkTableInternals(table, '', issues, ctx);
  return issues;
}

function checkTableInternals(table: NormalizedTable, base: string, issues: ContractIssue[], ctx: SemanticContext): void {
  checkSourceRef(table.sourceRef, pointer(base, 'sourceRef'), issues);
  const { range, headerRow, sheetId } = table.sourceRef;

  uniqueIds(table.columns, 'column', pointer(base, 'columns'), issues);
  const columnIds = new Set(table.columns.map((c) => c.id));
  const columnById = new Map(table.columns.map((c) => [c.id, c] as const));
  for (const [i, col] of table.columns.entries()) {
    if (col.sourceColumn < range.firstColumn || col.sourceColumn > range.lastColumn) {
      issues.push(issue('semantic', 'column.sourceColumn', pointer(pointer(base, 'columns'), i), `sourceColumn ${col.sourceColumn} outside selected range`));
    }
    checkUnit(col.unit, pointer(pointer(base, 'columns'), i), issues);
  }

  uniqueIds(table.rows, 'row', pointer(base, 'rows'), issues);
  uniqueIds(table.qualityIssues, 'qualityIssue', pointer(base, 'qualityIssues'), issues);
  const rowsBySourceRow = new Map<number, NormalizedRow>();
  for (const [i, row] of table.rows.entries()) {
    const p = pointer(pointer(base, 'rows'), i);
    rowsBySourceRow.set(row.sourceRow, row);
    if (row.sourceRefId !== table.sourceRef.id) {
      issues.push(issue('semantic', 'row.sourceRefId', pointer(p, 'sourceRefId'), `row references ${JSON.stringify(row.sourceRefId)}, expected ${JSON.stringify(table.sourceRef.id)}`));
    }
    if (row.id !== rowId(sheetId, row.sourceRow)) {
      issues.push(issue('semantic', 'row.id.binding', pointer(p, 'id'), `row id must bind sheet ordinal and physical row: expected ${JSON.stringify(rowId(sheetId, row.sourceRow))}`));
    }
    if (row.sourceRow < range.firstRow || row.sourceRow > range.lastRow || row.sourceRow === headerRow) {
      issues.push(issue('semantic', 'row.sourceRow.range', pointer(p, 'sourceRow'), `sourceRow ${row.sourceRow} outside data range or on the header row`));
    }
    const valueKeys = Object.keys(row.values);
    if (valueKeys.length !== columnIds.size || valueKeys.some((k) => !columnIds.has(k))) {
      issues.push(issue('semantic', 'row.values.columns', pointer(p, 'values'), 'row value keys must exactly match the column ids'));
    }
    for (const [key, v] of Object.entries(row.values)) {
      const col = columnById.get(key);
      if (col === undefined) continue;
      checkCellValue(v, col, pointer(pointer(p, 'values'), key), issues);
    }
  }

  for (const [i, q] of table.qualityIssues.entries()) {
    const p = pointer(pointer(base, 'qualityIssues'), i);
    if (q.sourceRefId !== table.sourceRef.id) {
      issues.push(issue('semantic', 'issue.sourceRefId', pointer(p, 'sourceRefId'), `issue references ${JSON.stringify(q.sourceRefId)}, expected ${JSON.stringify(table.sourceRef.id)}`));
    }
    if (q.fieldId !== null && !columnIds.has(q.fieldId)) {
      issues.push(issue('semantic', 'issue.fieldId', pointer(p, 'fieldId'), `unknown column ${JSON.stringify(q.fieldId)}`));
    }
    if (q.canonicalSourceRow !== null && !rowsBySourceRow.has(q.canonicalSourceRow)) {
      issues.push(issue('semantic', 'issue.canonicalRow', pointer(p, 'canonicalSourceRow'), `canonicalSourceRow ${q.canonicalSourceRow} is not a retained row`));
    }
  }

  for (const g of table.grain) {
    if (!columnIds.has(g)) issues.push(issue('semantic', 'grain.column', pointer(base, 'grain'), `grain column ${JSON.stringify(g)} is not a declared column`));
  }
  const cal = new Set<string>();
  for (const [i, d] of table.calendarDates.entries()) {
    if (!isValidDate(d)) issues.push(issue('semantic', 'calendar.date', pointer(pointer(base, 'calendarDates'), i), `not a real Gregorian date: ${JSON.stringify(d)}`));
    if (cal.has(d)) issues.push(issue('semantic', 'calendar.unique', pointer(pointer(base, 'calendarDates'), i), `duplicate calendar date ${d}`));
    cal.add(d);
  }

  if (table.policyVersion !== POLICY.version) {
    issues.push(issue('version', 'policy.version', pointer(base, 'policyVersion'), `policyVersion ${JSON.stringify(table.policyVersion)} ≠ active policy ${POLICY.version}`));
  }
  if (ctx.sourceHash !== undefined && table.sourceRef.sourceHash !== ctx.sourceHash) {
    issues.push(issue('semantic', 'sourceHash.mismatch', pointer(pointer(base, 'sourceRef'), 'sourceHash'), 'sourceHash does not match SHA-256 of the source bytes'));
  }
  checkKeyFields(table, base, issues);
}

function checkCellValue(v: string | boolean | null, col: Column, path: string, issues: ContractIssue[]): void {
  if (v === null) {
    if (!col.nullable) issues.push(issue('semantic', 'cell.nullable', path, `column ${col.id} is not nullable`));
    return;
  }
  switch (col.type) {
    case 'text':
    case 'identifier':
      if (typeof v !== 'string') issues.push(issue('semantic', 'cell.type', path, `${col.type} column requires text, got ${typeof v}`));
      break;
    case 'boolean':
      if (typeof v !== 'boolean') issues.push(issue('semantic', 'cell.type', path, `boolean column requires boolean, got ${typeof v}`));
      break;
    case 'date':
      if (typeof v !== 'string' || !isValidDate(v)) issues.push(issue('semantic', 'cell.date', path, 'date column requires a real ISO Gregorian date'));
      break;
    case 'decimal':
    case 'integer': {
      if (typeof v !== 'string' || !isDecimal(v)) {
        issues.push(issue('decimal', 'cell.decimal', path, `${col.type} column requires a canonical finite decimal string`));
        break;
      }
      if (col.type === 'integer' && !isIntegerDecimal(v)) {
        issues.push(issue('decimal', 'cell.integer', path, 'integer column requires a whole number'));
      }
      if (significantDigits(v) > POLICY.numeric.maxInputSignificantDigits) {
        issues.push(issue('decimal', 'cell.significantDigits', path, `value exceeds ${POLICY.numeric.maxInputSignificantDigits} significant digits`));
      }
      break;
    }
    case 'mixed':
      break;
  }
}

// ---------------------------------------------------------------------------
// Metric / Provenance / Finding / ChartSpec internals (shared by snapshot and scenario)
// ---------------------------------------------------------------------------

interface MetricBundle {
  readonly metrics: readonly Metric[];
  readonly proofs: readonly Provenance[];
  readonly findings: readonly Finding[];
  readonly charts: readonly ChartSpec[];
}

function checkMetricBundle(
  bundle: MetricBundle,
  base: string,
  issues: ContractIssue[],
  ctx: SemanticContext,
  expected: { normalizationRevision?: string | undefined; sourceHash?: string | undefined },
  merged?: MetricBundle,
): void {
  uniqueIds(bundle.metrics, 'metric', pointer(base, 'metrics'), issues);
  uniqueIds(bundle.proofs, 'provenance', pointer(base, 'provenance'), issues);
  // Id-resolution pools: the bundle's own ids plus, for scenario bundles, the
  // baseline bundle's ids (scenario expressions reference baseline metrics and
  // selections by id — the oracle resolves against the merged namespace).
  const metricSet = new Set([...(merged?.metrics ?? []), ...bundle.metrics].map((m) => m.id));
  const proofSet = new Set([...(merged?.proofs ?? []), ...bundle.proofs].map((p) => p.id));

  // Selections pool across all proofs in this bundle (the oracle resolves globally).
  const selectionIds = new Map<string, number>();
  for (const p of merged?.proofs ?? []) {
    for (const s of p.selections) selectionIds.set(s.id, -1);
  }
  for (const [pi, p] of bundle.proofs.entries()) {
    for (const s of p.selections) {
      if (selectionIds.has(s.id)) {
        issues.push(issue('semantic', 'id.unique', pointer(base, 'provenance'), `duplicate selection id ${JSON.stringify(s.id)}`));
      } else {
        selectionIds.set(s.id, pi);
      }
    }
  }

  const columnIds = ctx.table ? new Set(ctx.table.columns.map((c) => c.id)) : null;
  const rowsBySourceRow = ctx.table ? new Map(ctx.table.rows.map((r) => [r.sourceRow, r] as const)) : null;
  const issueMap = ctx.table ? new Map(ctx.table.qualityIssues.map((q) => [q.id, q] as const)) : null;
  const sheetId = ctx.table ? ctx.table.sourceRef.sheetId : null;

  // --- provenance internals ---
  for (const [i, p] of bundle.proofs.entries()) {
    const pp = pointer(pointer(base, 'provenance'), i);
    checkStatusTriple(p.status, p.result, p.reasonKey, pp, issues);
    const refIds = uniqueIds(p.sourceRefs, 'sourceRef', pointer(pp, 'sourceRefs'), issues);
    for (const [j, ref] of p.sourceRefs.entries()) {
      checkSourceRef(ref, pointer(pointer(pp, 'sourceRefs'), j), issues);
      if (expected.sourceHash !== undefined && ref.sourceHash !== expected.sourceHash) {
        issues.push(issue('semantic', 'sourceHash.mismatch', pointer(pointer(pp, 'sourceRefs'), j), 'sourceRef.sourceHash differs from the bound source hash'));
      }
    }
    if (expected.normalizationRevision !== undefined && p.normalizationRevision !== expected.normalizationRevision) {
      issues.push(issue('semantic', 'normalizationRevision.mismatch', pointer(pp, 'normalizationRevision'), 'proof normalizationRevision differs from the snapshot/table revision'));
    }
    if (p.policyVersion !== POLICY.version) {
      issues.push(issue('version', 'policy.version', pointer(pp, 'policyVersion'), `policyVersion ${JSON.stringify(p.policyVersion)} ≠ active policy ${POLICY.version}`));
    }
    for (const [j, s] of p.selections.entries()) {
      checkSelection(s, pointer(pointer(pp, 'selections'), j), issues, {
        sourceRefIds: new Set(refIds.keys()),
        sheetId,
        columnIds,
        rowsBySourceRow,
      });
    }
    if (issueMap !== null) {
      for (const t of p.transformIds) {
        const q = issueMap.get(t);
        if (q === undefined) {
          issues.push(issue('semantic', 'transformId.missing', pointer(pp, 'transformIds'), `transformId ${JSON.stringify(t)} is not a quality issue`));
        } else if (q.status !== 'resolved') {
          issues.push(issue('semantic', 'transformId.resolved', pointer(pp, 'transformIds'), `transformId ${JSON.stringify(t)} names issue with status ${q.status}, expected resolved`));
        }
      }
    }
    checkExpressionRefs(p.expression, pointer(pp, 'expression'), issues, {
      selections: new Set(selectionIds.keys()),
      metrics: metricSet,
      issues: new Set(issueMap?.keys() ?? []),
    });
  }

  // --- metrics ---
  for (const [i, m] of bundle.metrics.entries()) {
    const mp = pointer(pointer(base, 'metrics'), i);
    checkStatusTriple(m.status, m.value, m.reasonKey, mp, issues);
    checkUnit(m.unit, pointer(mp, 'unit'), issues);
    checkScope(m.scope, pointer(mp, 'scope'), issues);
    if (m.eligibleRows > m.totalRows) {
      issues.push(issue('semantic', 'metric.rows', mp, `eligibleRows ${m.eligibleRows} > totalRows ${m.totalRows}`));
    }
    const proof = bundle.proofs.find((p) => p.id === m.provenanceId);
    if (proof === undefined) {
      issues.push(issue('semantic', 'metric.provenance.missing', pointer(mp, 'provenanceId'), `unknown provenance ${JSON.stringify(m.provenanceId)}`));
    } else if (proof.status !== m.status) {
      issues.push(issue('semantic', 'metric.proofStatus', pointer(mp, 'provenanceId'), `metric status ${m.status} differs from proof status ${proof.status}`));
    }
  }

  // --- findings ---
  uniqueIds(bundle.findings, 'finding', pointer(base, 'findings'), issues);
  const chartIds = uniqueIds(bundle.charts, 'chart', pointer(base, 'charts'), issues);
  const issueIdsForRefs = new Set(issueMap?.keys() ?? []);
  for (const [i, f] of bundle.findings.entries()) {
    const fp = pointer(pointer(base, 'findings'), i);
    checkScope(f.scope, pointer(fp, 'scope'), issues);
    for (const id of f.metricIds) if (!metricSet.has(id)) issues.push(issue('semantic', 'finding.metricId', pointer(fp, 'metricIds'), `unknown metric ${JSON.stringify(id)}`));
    for (const id of f.provenanceIds) if (!proofSet.has(id)) issues.push(issue('semantic', 'finding.provenanceId', pointer(fp, 'provenanceIds'), `unknown provenance ${JSON.stringify(id)}`));
    if (issueMap !== null) {
      for (const id of f.qualityIssueIds) if (!issueIdsForRefs.has(id)) issues.push(issue('semantic', 'finding.qualityIssueId', pointer(fp, 'qualityIssueIds'), `unknown quality issue ${JSON.stringify(id)}`));
    }
    if (f.chartId !== null && !chartIds.has(f.chartId)) issues.push(issue('semantic', 'finding.chartId', pointer(fp, 'chartId'), `unknown chart ${JSON.stringify(f.chartId)}`));
    if (!isDecimal(f.rank.coverage)) issues.push(issue('decimal', 'finding.rank', pointer(fp, 'rank'), 'rank.coverage is not a finite decimal'));
    if (!isDecimal(f.rank.magnitude)) issues.push(issue('decimal', 'finding.rank', pointer(fp, 'rank'), 'rank.magnitude is not a finite decimal'));
  }

  // --- charts ---
  for (const [i, c] of bundle.charts.entries()) {
    const cp = pointer(pointer(base, 'charts'), i);
    checkScope(c.scope, pointer(cp, 'scope'), issues);
    checkUnit(c.unit, pointer(cp, 'unit'), issues);
    const seriesIds = new Set<string>();
    for (const s of c.series) {
      if (seriesIds.has(s.id)) issues.push(issue('semantic', 'chart.series.unique', pointer(cp, 'series'), `duplicate series id ${JSON.stringify(s.id)}`));
      seriesIds.add(s.id);
    }
    for (const [j, pt] of c.points.entries()) {
      const pp = pointer(pointer(cp, 'points'), j);
      for (const key of Object.keys(pt.values)) {
        if (!seriesIds.has(key)) issues.push(issue('semantic', 'chart.point.series', pp, `point value key ${JSON.stringify(key)} is not a series id`));
      }
      for (const id of pt.metricIds) {
        if (!metricSet.has(id)) issues.push(issue('semantic', 'chart.metricId', pointer(pp, 'metricIds'), `unknown metric ${JSON.stringify(id)}`));
      }
    }
    if (isDecimal(c.domain.min) && isDecimal(c.domain.max) && compareDecimal(c.domain.min, c.domain.max) > 0) {
      issues.push(issue('semantic', 'chart.domain', pointer(cp, 'domain'), 'domain min > max'));
    }
    for (const id of c.provenanceIds) if (!proofSet.has(id)) issues.push(issue('semantic', 'chart.provenanceId', pointer(cp, 'provenanceIds'), `unknown provenance ${JSON.stringify(id)}`));
  }
}

/**
 * Recompute every defined metric in `bundle` through its proof graph and
 * require numeric equality with the stated `metric.value`/`proof.result`
 * (precision 40, ROUND_HALF_UP). Needs ctx.table for row/issue resolution.
 */
function checkProofArithmetic(bundle: MetricBundle, base: string, issues: ContractIssue[], ctx: SemanticContext, merged?: MetricBundle): void {
  if (ctx.table === undefined) return;
  const evalCtx: EvalContext = buildEvalContext(
    ctx.table,
    [...(merged?.metrics ?? []), ...bundle.metrics],
    [...(merged?.proofs ?? []), ...bundle.proofs],
  );
  for (const [i, m] of bundle.metrics.entries()) {
    if (m.status !== 'defined') continue;
    const mp = pointer(pointer(base, 'metrics'), i);
    const outcome = evaluateMetric(m.id, evalCtx, issues, mp);
    if (outcome.status === 'undefined') {
      issues.push(issue('semantic', 'metric.evaluate', mp, `metric ${JSON.stringify(m.id)} is stated defined but its proof is undefined (${outcome.rule})`));
      continue;
    }
    const proof = bundle.proofs.find((p) => p.id === m.provenanceId);
    if (proof !== null && proof !== undefined && proof.result !== null && compareDecimal(outcome.value, proof.result) !== 0) {
      issues.push(issue('semantic', 'proof.result.mismatch', pointer(mp, 'provenanceId'), `recomputed ${outcome.value} ≠ stated proof result ${proof.result}`));
    }
    if (m.value !== null && compareDecimal(outcome.value, m.value) !== 0) {
      issues.push(issue('semantic', 'metric.value.mismatch', pointer(mp, 'value'), `recomputed ${outcome.value} ≠ stated metric value ${m.value}`));
    }
  }
}

// ---------------------------------------------------------------------------
// AnalysisSnapshot
// ---------------------------------------------------------------------------

export function checkAnalysisSnapshot(value: unknown, ctx: SemanticContext = {}): ContractIssue[] {
  const issues = checkSchema('AnalysisSnapshot', value);
  if (issues.length > 0 || !isPlainObject(value)) return issues;
  const snap = value as unknown as AnalysisSnapshot;

  checkMetricBundle(
    { metrics: snap.metrics, proofs: snap.provenance, findings: snap.findings, charts: snap.charts },
    '',
    issues,
    ctx,
    {
      normalizationRevision: snap.normalizationRevision,
      sourceHash: ctx.sourceHash ?? ctx.table?.sourceRef.sourceHash ?? snap.sourceHash,
    },
  );

  if (ctx.table !== undefined) {
    if (snap.sourceHash !== ctx.table.sourceRef.sourceHash) {
      issues.push(issue('semantic', 'sourceHash.mismatch', '/sourceHash', 'snapshot sourceHash differs from table sourceRef.sourceHash'));
    }
    if (snap.normalizationRevision !== ctx.table.normalizationRevision) {
      issues.push(issue('semantic', 'normalizationRevision.mismatch', '/normalizationRevision', 'snapshot normalizationRevision differs from the table'));
    }
    if (snap.tableId !== ctx.table.id) {
      issues.push(issue('semantic', 'snapshot.tableId', '/tableId', 'snapshot tableId does not match the normalized table id'));
    }
    reconcileQualitySummary(snap.qualitySummary, ctx.table, issues);
  }
  if (ctx.sourceHash !== undefined && snap.sourceHash !== ctx.sourceHash) {
    issues.push(issue('semantic', 'sourceHash.mismatch', '/sourceHash', 'snapshot sourceHash differs from SHA-256 of source bytes'));
  }
  checkProofArithmetic(
    { metrics: snap.metrics, proofs: snap.provenance, findings: snap.findings, charts: snap.charts },
    '',
    issues,
    ctx,
  );
  checkKeyFields(snap, '', issues);
  return issues;
}

function reconcileQualitySummary(summary: AnalysisSnapshot['qualitySummary'], table: NormalizedTable, issues: ContractIssue[]): void {
  const base = '/qualitySummary';
  const { range, headerRow } = table.sourceRef;
  const expectedRaw = range.lastRow - range.firstRow + 1 - (headerRow >= range.firstRow && headerRow <= range.lastRow ? 1 : 0);
  if (summary.rawRows !== expectedRaw) {
    issues.push(issue('semantic', 'qualitySummary.rawRows', pointer(base, 'rawRows'), `rawRows ${summary.rawRows} ≠ ${expectedRaw} source data rows in range`));
  }
  if (summary.retainedRows !== table.rows.length) {
    issues.push(issue('semantic', 'qualitySummary.retainedRows', pointer(base, 'retainedRows'), `retainedRows ${summary.retainedRows} ≠ ${table.rows.length} normalized rows`));
  }
  if (summary.issueCount !== table.qualityIssues.length) {
    issues.push(issue('semantic', 'qualitySummary.issueCount', pointer(base, 'issueCount'), `issueCount ${summary.issueCount} ≠ ${table.qualityIssues.length} ledger entries`));
  }
  const resolved = table.qualityIssues.filter((q) => q.status === 'resolved').length;
  const unresolved = table.qualityIssues.filter((q) => q.status === 'unresolved').length;
  if (summary.resolved !== resolved) issues.push(issue('semantic', 'qualitySummary.resolved', pointer(base, 'resolved'), `resolved ${summary.resolved} ≠ ledger count ${resolved}`));
  if (summary.unresolved !== unresolved) issues.push(issue('semantic', 'qualitySummary.unresolved', pointer(base, 'unresolved'), `unresolved ${summary.unresolved} ≠ ledger count ${unresolved}`));
}

// ---------------------------------------------------------------------------
// ScenarioResult
// ---------------------------------------------------------------------------

export function checkScenarioResult(value: unknown, ctx: SemanticContext = {}): ContractIssue[] {
  const issues = checkSchema('ScenarioResult', value);
  if (issues.length > 0 || !isPlainObject(value)) return issues;
  const sc = value as unknown as ScenarioResult;

  // status: 'unavailable' requires a reason; 'defined' forbids one.
  if (sc.status === 'defined' && sc.reasonKey !== null) {
    issues.push(issue('semantic', 'scenario.status', '/reasonKey', 'status "defined" requires reasonKey null'));
  }
  if (sc.status === 'unavailable' && (typeof sc.reasonKey !== 'string' || sc.reasonKey.length === 0)) {
    issues.push(issue('semantic', 'scenario.status', '/reasonKey', 'status "unavailable" requires a non-empty reasonKey'));
  }
  if (!isDecimal(sc.costChange)) {
    issues.push(issue('decimal', 'scenario.costChange', '/costChange', 'costChange is not a canonical finite decimal'));
  } else {
    if (compareDecimal(sc.costChange, '-0.20') < 0 || compareDecimal(sc.costChange, '0.30') > 0) {
      issues.push(issue('semantic', 'scenario.bounds', '/costChange', 'costChange outside [-0.20, 0.30] — never silently clamp'));
    }
    if (!isMultipleOfStep(sc.costChange, '0.001')) {
      issues.push(issue('semantic', 'scenario.step', '/costChange', 'costChange is not an exact multiple of the typed step 0.001'));
    }
  }
  checkScope(sc.scope, '/scope', issues);

  const definition = ctx.definition;
  if (definition !== undefined) {
    if (sc.definitionId !== definition.id) {
      issues.push(issue('semantic', 'scenario.definitionId', '/definitionId', `definitionId ${JSON.stringify(sc.definitionId)} ≠ ${JSON.stringify(definition.id)}`));
    }
  }

  const snap = ctx.snapshot;
  if (snap !== undefined) {
    if (sc.baselineAnalysisId !== snap.id) {
      issues.push(issue('semantic', 'scenario.baseline', '/baselineAnalysisId', 'baselineAnalysisId does not match the baseline snapshot id'));
    }
    if (!deepEqual(sc.scope, snap.scope)) {
      issues.push(issue('semantic', 'scenario.scope', '/scope', 'scenario scope must equal the immutable baseline scope (v1 scenario is scope-preserving)'));
    }
    if (definition !== undefined) {
      for (const requiredId of definition.requiresMetricIds) {
        const required = snap.metrics.find((m) => m.id === requiredId);
        if (required === undefined) {
          issues.push(issue('semantic', 'scenario.requiresMetric', '/metrics', `required baseline metric ${JSON.stringify(requiredId)} is absent`));
        } else if (required.status !== 'defined') {
          issues.push(issue('semantic', 'scenario.requiresMetric', '/metrics', `required baseline metric ${JSON.stringify(requiredId)} is not defined`));
        }
      }
      // operating-cost-v1 semantics: nonpositive revenue or negative cost disables the recipe.
      const revenue = snap.metrics.find((m) => m.id === definition.requiresMetricIds[0]);
      const cost = snap.metrics.find((m) => m.id === definition.requiresMetricIds[1]);
      if (revenue?.unit.kind === 'currency' && cost?.unit.kind === 'currency' && revenue.unit.currency !== cost.unit.currency) {
        issues.push(issue('semantic', 'scenario.unitCompatible', '/metrics', 'required metrics use incompatible currencies'));
      }
      if (revenue !== undefined && revenue.value !== null && cost !== undefined && cost.value !== null) {
        const disabled = compareDecimal(revenue.value, '0') <= 0 || compareDecimal(cost.value, '0') < 0;
        if (disabled && sc.status === 'defined') {
          issues.push(issue('semantic', 'scenario.disabled', '/status', 'nonpositive revenue or negative cost disables the operating-cost scenario — status must be "unavailable"'));
        }
      }
    }
    // Scenario ids share the snapshot's metric/proof namespace.
    const snapMetricIds = new Set(snap.metrics.map((m) => m.id));
    const snapProofIds = new Set(snap.provenance.map((p) => p.id));
    for (const [i, m] of sc.metrics.entries()) {
      if (snapMetricIds.has(m.id)) issues.push(issue('semantic', 'id.unique', pointer('/metrics', i), `scenario metric id ${JSON.stringify(m.id)} collides with baseline`));
    }
    for (const [i, p] of sc.provenance.entries()) {
      if (snapProofIds.has(p.id)) issues.push(issue('semantic', 'id.unique', pointer('/provenance', i), `scenario provenance id ${JSON.stringify(p.id)} collides with baseline`));
    }
  }

  const baselineBundle =
    snap === undefined
      ? undefined
      : { metrics: snap.metrics, proofs: snap.provenance, findings: snap.findings, charts: snap.charts };
  checkMetricBundle(
    { metrics: sc.metrics, proofs: sc.provenance, findings: [], charts: [] },
    '',
    issues,
    ctx,
    {
      normalizationRevision: ctx.snapshot?.normalizationRevision ?? ctx.table?.normalizationRevision,
      sourceHash: ctx.sourceHash ?? ctx.table?.sourceRef.sourceHash ?? ctx.snapshot?.sourceHash,
    },
    baselineBundle,
  );
  checkProofArithmetic(
    { metrics: sc.metrics, proofs: sc.provenance, findings: [], charts: [] },
    '',
    issues,
    ctx,
    snap === undefined ? undefined : { metrics: snap.metrics, proofs: snap.provenance, findings: snap.findings, charts: snap.charts },
  );
  checkKeyFields(sc, '', issues);
  return issues;
}

// ---------------------------------------------------------------------------
// ExportModel
// ---------------------------------------------------------------------------

const SAFE_SHEET_NAME = /^[^[\]:*?/\\]+$/;

function checkSheetName(name: string, path: string, issues: ContractIssue[]): void {
  if (name.length > 31) issues.push(issue('semantic', 'sheet.name.length', path, 'sheet name exceeds 31 characters'));
  if (!SAFE_SHEET_NAME.test(name)) issues.push(issue('semantic', 'sheet.name.chars', path, 'sheet name contains forbidden characters []:*?/\\'));
  if (/^[=+\-@]/.test(name) || /^'/.test(name)) issues.push(issue('semantic', 'sheet.name.formula', path, 'sheet name starts with a formula-significant character'));

  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point of this check
  if (/[\u0000-\u001F\u007F]/.test(name)) issues.push(issue('semantic', 'sheet.name.control', path, 'sheet name contains control characters'));
}

export function checkExportModel(value: unknown, ctx: SemanticContext = {}): ContractIssue[] {
  const issues = checkSchema('ExportModel', value);
  if (issues.length > 0 || !isPlainObject(value)) return issues;
  const model = value as unknown as ExportModel;

  const sheetIds = uniqueIds(model.sheets, 'sheet', '/sheets', issues);
  if (model.sheets.length !== 5) issues.push(issue('semantic', 'sheets.count', '/sheets', `expected exactly five sheet models, got ${model.sheets.length}`));
  for (const [i, s] of model.sheets.entries()) checkSheetName(s.name, pointer('/sheets', i), issues);
  void sheetIds;

  uniqueIds(model.slides, 'slide', '/slides', issues);
  // The scenario page exists only for a committed scenario — a section
  // with nothing to say is omitted from the deck, never shipped empty.
  const scenarioCommitted = model.scenario !== null && model.scenario.status === 'defined';
  const expectedSlides = scenarioCommitted ? 6 : 5;
  if (model.slides.length !== expectedSlides) issues.push(issue('semantic', 'slides.count', '/slides', `expected ${expectedSlides} slides for ${scenarioCommitted ? 'a committed' : 'no committed'} scenario, got ${model.slides.length}`));
  const scenarioSlides = model.slides.filter((s) => s.kind === 'scenario').length;
  if (scenarioSlides !== (scenarioCommitted ? 1 : 0)) issues.push(issue('semantic', 'slides.scenario', '/slides', `expected ${scenarioCommitted ? 'exactly one' : 'no'} scenario slide, got ${scenarioSlides}`));

  const metricSet = new Set([...model.metrics.map((m) => m.id), ...(model.scenario?.metrics ?? []).map((m) => m.id)]);
  const findingSet = new Set(model.findings.map((f) => f.id));
  const chartSet = new Set(model.charts.map((c) => c.id));
  for (const [i, s] of model.slides.entries()) {
    const sp = pointer('/slides', i);
    for (const id of s.metricIds) if (!metricSet.has(id)) issues.push(issue('semantic', 'slide.metricId', pointer(sp, 'metricIds'), `slide references unknown metric ${JSON.stringify(id)}`));
    for (const id of s.findingIds) if (!findingSet.has(id)) issues.push(issue('semantic', 'slide.findingId', pointer(sp, 'findingIds'), `slide references unknown finding ${JSON.stringify(id)}`));
    for (const id of s.chartIds) if (!chartSet.has(id)) issues.push(issue('semantic', 'slide.chartId', pointer(sp, 'chartIds'), `slide references unknown chart ${JSON.stringify(id)}`));
  }

  checkMetricBundle(
    { metrics: model.metrics, proofs: model.provenance, findings: model.findings, charts: model.charts },
    '',
    issues,
    { ...ctx, table: model.table },
    { normalizationRevision: model.table.normalizationRevision, sourceHash: model.sourceHash },
    model.scenario === null
      ? undefined
      : { metrics: model.scenario.metrics, proofs: model.scenario.provenance, findings: [], charts: [] },
  );

  if (model.sourceHash !== model.table.sourceRef.sourceHash) {
    issues.push(issue('semantic', 'sourceHash.mismatch', '/sourceHash', 'export sourceHash differs from embedded table sourceRef.sourceHash'));
  }
  if (ctx.table !== undefined && !deepEqual(model.table, ctx.table)) {
    issues.push(issue('semantic', 'export.table', '/table', 'embedded table differs from the validated normalized table'));
  }
  if (ctx.snapshot !== undefined) {
    if (model.analysisId !== ctx.snapshot.id) issues.push(issue('semantic', 'export.analysisId', '/analysisId', 'analysisId does not match the snapshot'));
    if (model.sourceHash !== ctx.snapshot.sourceHash) issues.push(issue('semantic', 'sourceHash.mismatch', '/sourceHash', 'export sourceHash differs from snapshot'));
  }
  if (model.scenario !== null) {
    if (model.scenario.baselineAnalysisId !== model.analysisId) {
      issues.push(issue('semantic', 'export.scenarioBaseline', '/scenario/baselineAnalysisId', 'scenario baseline does not match export analysisId'));
    }
    checkMetricBundle(
      { metrics: model.scenario.metrics, proofs: model.scenario.provenance, findings: [], charts: [] },
      '/scenario',
      issues,
      { ...ctx, table: model.table },
      { normalizationRevision: model.table.normalizationRevision, sourceHash: model.sourceHash },
      { metrics: model.metrics, proofs: model.provenance, findings: model.findings, charts: model.charts },
    );
  }
  checkKeyFields(model, '', issues);
  return issues;
}

// ---------------------------------------------------------------------------
// Remaining contract types — structural + intra-document semantics
// ---------------------------------------------------------------------------

export function checkFinding(value: unknown): ContractIssue[] {
  const issues = checkSchema('Finding', value);
  if (issues.length > 0 || !isPlainObject(value)) return issues;
  const f = value as unknown as Finding;
  checkScope(f.scope, '/scope', issues);
  if (!isDecimal(f.rank.coverage) || !isDecimal(f.rank.magnitude)) {
    issues.push(issue('decimal', 'finding.rank', '/rank', 'rank coverage/magnitude must be finite decimals'));
  }
  checkKeyFields(f, '', issues);
  return issues;
}

export function checkProvenance(value: unknown): ContractIssue[] {
  const issues = checkSchema('Provenance', value);
  if (issues.length > 0 || !isPlainObject(value)) return issues;
  const p = value as unknown as Provenance;
  checkStatusTriple(p.status, p.result, p.reasonKey, '', issues);
  if (p.policyVersion !== POLICY.version) {
    issues.push(issue('version', 'policy.version', '/policyVersion', `policyVersion ${JSON.stringify(p.policyVersion)} ≠ active policy ${POLICY.version}`));
  }
  const refIds = uniqueIds(p.sourceRefs, 'sourceRef', '/sourceRefs', issues);
  for (const [j, ref] of p.sourceRefs.entries()) checkSourceRef(ref, pointer('/sourceRefs', j), issues);
  const selIds = new Set<string>();
  for (const [j, s] of p.selections.entries()) {
    if (selIds.has(s.id)) issues.push(issue('semantic', 'id.unique', pointer('/selections', j), `duplicate selection id ${JSON.stringify(s.id)}`));
    selIds.add(s.id);
    checkSelection(s, pointer('/selections', j), issues, {
      sourceRefIds: new Set(refIds.keys()),
      sheetId: p.sourceRefs.find((r) => r.id === s.sourceRefId)?.sheetId ?? null,
      columnIds: null,
      rowsBySourceRow: null,
    });
  }
  checkKeyFields(p, '', issues);
  return issues;
}

export function checkScenarioDefinition(value: unknown): ContractIssue[] {
  const issues = checkSchema('ScenarioDefinition', value);
  if (issues.length > 0 || !isPlainObject(value)) return issues;
  const d = value as unknown as ScenarioDefinition;
  if (compareDecimal(d.parameter.min, d.parameter.max) > 0) {
    issues.push(issue('semantic', 'definition.bounds', '/parameter', 'parameter min > max'));
  }
  if (!isMultipleOfStep(d.parameter.default, d.parameter.typedStep)) {
    issues.push(issue('semantic', 'definition.step', '/parameter/default', 'parameter default is not an exact multiple of typedStep'));
  }
  checkKeyFields(d, '', issues);
  return issues;
}

export function checkWorkerRequest(value: unknown): ContractIssue[] {
  return checkSchema('WorkerRequest', value);
}

export function checkWorkerResponse(value: unknown): ContractIssue[] {
  return checkSchema('WorkerResponse', value);
}

export function checkRawTable(value: unknown): ContractIssue[] {
  const issues = checkSchema('RawTable', value);
  if (issues.length > 0 || !isPlainObject(value)) return issues;
  const t = value as unknown as RawTable;
  checkSourceRef(t.sourceRef, '/sourceRef', issues);
  const coords = new Set<string>();
  for (const [i, c] of t.cells.entries()) {
    const key = `${c.row}:${c.column}`;
    if (coords.has(key)) issues.push(issue('semantic', 'cell.unique', pointer('/cells', i), `duplicate cell coordinate ${key}`));
    coords.add(key);
  }
  return issues;
}

export function checkSampleManifest(value: unknown): ContractIssue[] {
  const issues = checkSchema('SampleManifest', value);
  if (issues.length > 0 || !isPlainObject(value)) return issues;
  const m = value as unknown as SampleManifest;
  if (m.cleanRecords > m.rawRecords) {
    issues.push(issue('semantic', 'manifest.records', '/cleanRecords', 'cleanRecords exceeds rawRecords'));
  }
  const quality = m.quality;
  if (quality.issueCount !== quality.duplicateRows + quality.categoryCells + quality.missingOptionalCells) {
    issues.push(issue('semantic', 'manifest.issueCount', '/quality/issueCount', 'issueCount does not equal the sum of duplicate/category/missing counts'));
  }
  if (quality.resolved + quality.unresolved !== quality.issueCount) {
    issues.push(issue('semantic', 'manifest.qualityStatus', '/quality', 'resolved + unresolved must equal issueCount — each issue has exactly one status'));
  }
  return issues;
}

export function checkNormalizedRow(value: unknown): ContractIssue[] {
  return checkSchema('NormalizedRow', value);
}

// ---------------------------------------------------------------------------
// Generic dispatch + assertion helpers
// ---------------------------------------------------------------------------

const CHECKERS = {
  NormalizedTable: checkNormalizedTable,
  AnalysisSnapshot: checkAnalysisSnapshot,
  ScenarioResult: checkScenarioResult,
  ExportModel: checkExportModel,
  Finding: checkFinding,
  Provenance: checkProvenance,
  ScenarioDefinition: checkScenarioDefinition,
  WorkerRequest: checkWorkerRequest,
  WorkerResponse: checkWorkerResponse,
  RawTable: checkRawTable,
  SampleManifest: checkSampleManifest,
  NormalizedRow: checkNormalizedRow,
} as const;

export type CheckableTypeName = keyof typeof CHECKERS;

/** Structural + semantic validation for any contract type that has a checker. */
export function checkContract(type: CheckableTypeName, value: unknown, ctx: SemanticContext = {}): ContractIssue[] {
  return (CHECKERS[type] as (v: unknown, c: SemanticContext) => ContractIssue[])(value, ctx);
}

export function validateContract<T>(type: CheckableTypeName, value: unknown, ctx: SemanticContext = {}): ValidationResult<T> {
  const issues = checkContract(type, value, ctx);
  return issues.length === 0 ? { ok: true, value: value as T, issues: [] } : { ok: false, issues };
}

export function assertContract<T>(type: CheckableTypeName, value: unknown, ctx: SemanticContext = {}): T {
  const issues = checkContract(type, value, ctx);
  if (issues.length > 0) throw new ContractError(issues);
  return value as T;
}

// Named convenience assertions for the composite documents.
export const assertNormalizedTable = (v: unknown, ctx?: SemanticContext): NormalizedTable => assertContract('NormalizedTable', v, ctx);
export const assertAnalysisSnapshot = (v: unknown, ctx?: SemanticContext): AnalysisSnapshot => assertContract('AnalysisSnapshot', v, ctx);
export const assertScenarioResult = (v: unknown, ctx?: SemanticContext): ScenarioResult => assertContract('ScenarioResult', v, ctx);
export const assertExportModel = (v: unknown, ctx?: SemanticContext): ExportModel => assertContract('ExportModel', v, ctx);
export const assertWorkerRequest = (v: unknown): WorkerRequest => assertContract('WorkerRequest', v);
export const assertWorkerResponse = (v: unknown): WorkerResponse => assertContract('WorkerResponse', v);
