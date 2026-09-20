/**
 * Sample rule pack: the versioned editorial rules for the confirmed
 * regional-services sample. Fires only with an explicit sample policy id
 * and the sample's confirmed columns; generic uploads never reach this
 * code path, so sample field names cannot leak into generic ranking.
 *
 * Metrics, proofs, findings and charts reproduce the checked-in golden
 * snapshot up to the snapshot id (which binds this implementation's
 * identity scheme) and chart domain bounds (editorial).
 */
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  isDecimal,
  normalizeDecimalString,
  POLICY,
  subtractDecimal,
} from '@rowfolio/contracts';
import type {
  ChartSpec,
  Column,
  Expression,
  Finding,
  Metric,
  NormalizedRow,
  NormalizedTable,
  Provenance,
  Scope,
  SourceRef,
  Unit,
} from '@rowfolio/contracts';
import {
  absDecimal,
  domainMax,
  iqrFlag,
  relativeChange,
  trendDirection,
} from './mechanics.ts';
import {
  findDateColumn,
  findRegionColumn,
  isPeriodComplete,
  previousMonthPeriod,
  scopeRows,
  sharedMask,
  sumField,
  toSpans,
  type Period,
} from './scope.ts';

export const SAMPLE_COLUMN_IDS = [
  'operation_id',
  'date',
  'region',
  'site',
  'revenue',
  'target_revenue',
  'order_volume',
  'operating_cost',
  'downtime_minutes',
  'maintenance_cost',
  'csat_score',
] as const;

export function hasSampleColumns(table: NormalizedTable): boolean {
  const ids = new Set(table.columns.map((c) => c.id));
  return SAMPLE_COLUMN_IDS.every((id) => ids.has(id));
}

const RATIO_UNIT: Unit = { kind: 'ratio', label: 'fraction', currency: null };

/** ISO 4217 currency declared by the bound sample manifest. */
const SAMPLE_CURRENCY: Unit = { kind: 'currency', label: 'USD', currency: 'USD' };
const SAMPLE_CURRENCY_COLUMNS = new Set([
  'revenue',
  'target_revenue',
  'operating_cost',
  'maintenance_cost',
]);

/**
 * The hash-bound sample manifest declares `currency: "USD"` for its money
 * measures; ingested columns arrive with the generic unknown unit, so the
 * pack binds the declared currency before any measure reads `column.unit`.
 */
function bindSampleCurrency(table: NormalizedTable): NormalizedTable {
  return {
    ...table,
    columns: table.columns.map((column) =>
      SAMPLE_CURRENCY_COLUMNS.has(column.id) ? { ...column, unit: SAMPLE_CURRENCY } : column,
    ),
  };
}

const ACTION_ORDER: Record<string, number> = {
  'map-category': 0,
  'use-cache': 1,
  none: 2,
  'confirm-type': 3,
  'exclude-row': 4,
};

function resolvedIds(table: NormalizedTable): string[] {
  return table.qualityIssues.filter((q) => q.status === 'resolved').map((q) => q.id);
}

function columnOf(table: NormalizedTable, id: string): Column {
  const column = table.columns.find((c) => c.id === id);
  if (column === undefined) throw new SamplePackError(`sample table lacks column ${JSON.stringify(id)}`);
  return column;
}

export class SamplePackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SamplePackError';
  }
}

interface PackContext {
  readonly table: NormalizedTable;
  readonly scope: Scope;
  readonly dateColumn: Column;
  readonly regionColumn: Column | null;
  readonly june: Period;
  readonly may: Period;
  readonly resolved: string[];
}

function packContext(table: NormalizedTable, scope: Scope): PackContext {
  const dateColumn = findDateColumn(table);
  if (dateColumn === null) throw new SamplePackError('sample pack requires a date column');
  if (scope.periodStart === null || scope.periodEnd === null) {
    throw new SamplePackError('sample pack requires a bounded period scope');
  }
  const june: Period = { start: scope.periodStart, end: scope.periodEnd };
  return {
    table,
    scope,
    dateColumn,
    regionColumn: findRegionColumn(table),
    june,
    may: previousMonthPeriod(scope.periodStart),
    resolved: resolvedIds(table),
  };
}

function periodScope(ctx: PackContext, period: Period, regions: readonly string[], complete: boolean): Scope {
  return {
    tableId: ctx.table.id,
    periodStart: period.start,
    periodEnd: period.end,
    regions: [...regions],
    complete,
    coverageNoteKey: ctx.scope.coverageNoteKey,
  };
}

interface BuiltSum {
  readonly metric: Metric;
  readonly proof: Provenance;
  readonly total: string;
  readonly eligibleRows: number;
  readonly totalRows: number;
}

function buildSum(
  ctx: PackContext,
  id: string,
  labelKey: string,
  unit: Unit,
  field: string,
  metricScope: Scope,
  mask: readonly NormalizedRow[],
  totalRows: number,
): BuiltSum {
  const eligible = mask.filter(
    (r) => typeof r.values[field] === 'string' && isDecimal(r.values[field] as string),
  );
  let total = '0';
  let scale = 0;
  for (const row of eligible) {
    const value = row.values[field] as string;
    total = addDecimal(total, value);
    const dot = value.indexOf('.');
    if (dot !== -1) scale = Math.max(scale, value.length - dot - 1);
  }
  // Exact sum, then money display scale: trailing zeros carry the declared
  // scale (the golden revenue reads `881000.00`, not `881000`).
  const scaled = formatScale(total, scale);
  const sourceRows = eligible.map((r) => r.sourceRow);
  const spanSet = new Set(sourceRows);
  // Excluded rows stay visible: duplicates whose retained canonical row
  // contributes here are named (e.g. the May copy excluded from analysis).
  const excludedRowIds = ctx.table.qualityIssues
    .filter(
      (q) => q.kind === 'duplicate' && q.status === 'resolved'
        && q.canonicalSourceRow !== null && spanSet.has(q.canonicalSourceRow),
    )
    .map((q) => `${ctx.table.sourceRef.sheetId}:R${q.sourceRow}`)
    .sort();
  const selectionId = `${id}-rows`;
  const proofId = `${id}-proof`;
  const warnings = ctx.table.qualityIssues.some(
    (q) => q.kind === 'formula-cache' && q.status === 'resolved' && q.fieldId === field,
  )
    ? ['limitations.cache']
    : [];
  return {
    total: scaled,
    eligibleRows: eligible.length,
    totalRows,
    metric: {
      id,
      labelKey,
      value: scaled,
      status: 'defined',
      reasonKey: null,
      unit,
      scope: metricScope,
      eligibleRows: eligible.length,
      totalRows,
      provenanceId: proofId,
      warnings,
    },
    proof: {
      id: proofId,
      sourceRefs: [{ ...ctx.table.sourceRef }],
      selections: [
        {
          id: selectionId,
          sourceRefId: ctx.table.sourceRef.id,
          spans: toSpans(sourceRows),
          rowCount: sourceRows.length,
          fieldIds: [field],
          excludedRowIds,
          maskPolicy: 'shared-valid',
        },
      ],
      expression: { op: 'sum', selectionId, fieldId: field },
      result: scaled,
      status: 'defined',
      reasonKey: null,
      policyVersion: POLICY.version,
      normalizationRevision: ctx.table.normalizationRevision,
      transformIds: [...ctx.resolved],
      precision: 40,
      rounding: 'ROUND_HALF_UP',
    },
  };
}

/** Fraction digits carried by a decimal literal (money display scale). */
export function fractionScale(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

/** Pad an exact total to the input display scale (never rounds a nonzero fraction away). */
export function formatScale(total: string, scale: number): string {
  const negative = total.startsWith('-');
  const body = negative ? total.slice(1) : total;
  const dot = body.indexOf('.');
  const int = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? '' : body.slice(dot + 1);
  if (frac.length >= scale) return total;
  if (scale === 0) return negative ? `-${int}` : int;
  return `${negative ? '-' : ''}${int}.${frac.padEnd(scale, '0')}`;
}

function compositeProof(
  ctx: PackContext,
  id: string,
  expression: Expression,
  result: string,
): Provenance {
  return {
    id,
    sourceRefs: [{ ...ctx.table.sourceRef }] as SourceRef[],
    selections: [],
    expression,
    result,
    status: 'defined',
    reasonKey: null,
    policyVersion: POLICY.version,
    normalizationRevision: ctx.table.normalizationRevision,
    transformIds: [...ctx.resolved],
    precision: 40,
    rounding: 'ROUND_HALF_UP',
  };
}

function compositeMetric(
  id: string,
  labelKey: string,
  unit: Unit,
  value: string,
  metricScope: Scope,
  eligibleRows: number,
  totalRows: number,
  provenanceId: string,
): Metric {
  return {
    id,
    labelKey,
    value,
    status: 'defined',
    reasonKey: null,
    unit,
    scope: metricScope,
    eligibleRows,
    totalRows,
    provenanceId,
    warnings: [],
  };
}

/** Explicit undefined denominator: a status with a reason, never a zero. */
function undefinedMetric(
  id: string,
  labelKey: string,
  metricScope: Scope,
  eligibleRows: number,
  totalRows: number,
  provenanceId: string,
  reasonKey: string,
): Metric {
  return {
    id,
    labelKey,
    value: null,
    status: 'undefined',
    reasonKey,
    unit: RATIO_UNIT,
    scope: metricScope,
    eligibleRows,
    totalRows,
    provenanceId,
    warnings: [],
  };
}

export interface SamplePack {
  readonly metrics: Metric[];
  readonly provenance: Provenance[];
  readonly findings: Finding[];
  readonly charts: ChartSpec[];
  readonly evaluatedTrends: readonly string[];
  readonly evaluatedOutliers: readonly string[];
}

export function buildSamplePack(unboundTable: NormalizedTable, scope: Scope): SamplePack {
  const table = bindSampleCurrency(unboundTable);
  const ctx = packContext(table, scope);
  const revenueCol = columnOf(table, 'revenue');
  const targetCol = columnOf(table, 'target_revenue');
  const ordersCol = columnOf(table, 'order_volume');
  const costCol = columnOf(table, 'operating_cost');
  const downtimeCol = columnOf(table, 'downtime_minutes');

  const juneComplete = isPeriodComplete(table, ctx.dateColumn, ctx.june, scope.complete);
  const mayComplete = isPeriodComplete(table, ctx.dateColumn, ctx.may, scope.complete);
  const juneNorth = periodScope(ctx, ctx.june, ['North'], juneComplete);
  const mayNorth = periodScope(ctx, ctx.may, ['North'], mayComplete);
  const juneAll = periodScope(ctx, ctx.june, [], juneComplete);

  const juneNorthRows = scopeRows(table, ctx.dateColumn, ctx.june, ctx.regionColumn, ['North']);
  const mayNorthRows = scopeRows(table, ctx.dateColumn, ctx.may, ctx.regionColumn, ['North']);
  const juneAllRows = scopeRows(table, ctx.dateColumn, ctx.june, ctx.regionColumn, []);

  // Revenue and target share one mask so the gap never mixes populations.
  const pairMask = sharedMask(juneNorthRows.rows, ['revenue', 'target_revenue']);
  const revenue = buildSum(ctx, 'north-june-revenue', 'metric.revenue', revenueCol.unit, 'revenue', juneNorth, pairMask, juneNorthRows.rows.length);
  const target = buildSum(ctx, 'north-june-target', 'metric.target_revenue', targetCol.unit, 'target_revenue', juneNorth, pairMask, juneNorthRows.rows.length);

  const mayOrders = buildSum(ctx, 'north-may-orders', 'metric.order_volume', ordersCol.unit, 'order_volume', mayNorth, mayNorthRows.rows, mayNorthRows.rows.length);
  const juneOrders = buildSum(ctx, 'north-june-orders', 'metric.order_volume', ordersCol.unit, 'order_volume', juneNorth, juneNorthRows.rows, juneNorthRows.rows.length);
  const mayDowntime = buildSum(ctx, 'north-may-downtime', 'metric.downtime_minutes', downtimeCol.unit, 'downtime_minutes', mayNorth, mayNorthRows.rows, mayNorthRows.rows.length);
  const juneDowntime = buildSum(ctx, 'north-june-downtime', 'metric.downtime_minutes', downtimeCol.unit, 'downtime_minutes', juneNorth, juneNorthRows.rows, juneNorthRows.rows.length);

  const juneMask = sharedMask(juneAllRows.rows, ['revenue', 'operating_cost']);
  const juneRevenue = buildSum(ctx, 'june-revenue', 'metric.revenue', revenueCol.unit, 'revenue', juneAll, juneMask, juneAllRows.rows.length);
  const juneCost = buildSum(ctx, 'june-operating-cost', 'metric.operating_cost', costCol.unit, 'operating_cost', juneAll, juneMask, juneAllRows.rows.length);

  const metrics: Metric[] = [];
  const provenance: Provenance[] = [];
  for (const part of [revenue, target, mayOrders, juneOrders, mayDowntime, juneDowntime, juneRevenue, juneCost]) {
    metrics.push(part.metric);
    provenance.push(part.proof);
  }

  // Target gap (requires target > 0 and a shared, covered scope).
  const gapExpr: Expression = {
    op: 'divide',
    left: {
      op: 'subtract',
      left: { op: 'metric', metricId: 'north-june-revenue' },
      right: { op: 'metric', metricId: 'north-june-target' },
    },
    right: { op: 'metric', metricId: 'north-june-target' },
  };
  const gapValue = compareDecimal(target.total, '0') > 0
    ? divideDecimal(subtractDecimal(revenue.total, target.total), target.total)
    : null;
  if (gapValue !== null) {
    metrics.push(compositeMetric('north-target-gap', 'metric.targetGap', RATIO_UNIT, gapValue, juneNorth, pairMask.length, juneNorthRows.rows.length, 'north-target-gap-proof'));
    provenance.push(compositeProof(ctx, 'north-target-gap-proof', gapExpr, gapValue));
  } else {
    metrics.push(undefinedMetric('north-target-gap', 'metric.targetGap', juneNorth, pairMask.length, juneNorthRows.rows.length, 'north-june-target-proof', 'metric.targetNonPositive'));
  }

  // Orders change.
  const ordersChange = relativeChange(juneOrders.total, mayOrders.total);
  const ordersExpr: Expression = {
    op: 'divide',
    left: {
      op: 'subtract',
      left: { op: 'metric', metricId: 'north-june-orders' },
      right: { op: 'metric', metricId: 'north-may-orders' },
    },
    right: { op: 'metric', metricId: 'north-may-orders' },
  };
  if (ordersChange.value !== null) {
    metrics.push(compositeMetric('north-orders-change', 'metric.ordersChange', RATIO_UNIT, ordersChange.value, juneNorth, juneNorthRows.rows.length, juneNorthRows.rows.length, 'north-orders-change-proof'));
    provenance.push(compositeProof(ctx, 'north-orders-change-proof', ordersExpr, ordersChange.value));
  } else {
    metrics.push(undefinedMetric('north-orders-change', 'metric.ordersChange', juneNorth, juneNorthRows.rows.length, juneNorthRows.rows.length, 'north-may-orders-proof', 'metric.notComputable'));
  }

  // Downtime change (zero previous period is not computable, never infinite).
  const downtimeChange = relativeChange(juneDowntime.total, mayDowntime.total);
  const downtimeValue = downtimeChange.value ?? downtimeChange.absolute;
  if (downtimeChange.status === 'not_computable') {
    metrics.push(undefinedMetric('north-downtime-change', 'metric.downtimeChange', juneNorth, juneNorthRows.rows.length, juneNorthRows.rows.length, 'north-may-downtime-proof', 'metric.notComputable'));
  } else {
    const downtimeExpr: Expression = {
      op: 'divide',
      left: {
        op: 'subtract',
        left: { op: 'metric', metricId: 'north-june-downtime' },
        right: { op: 'metric', metricId: 'north-may-downtime' },
      },
      right: { op: 'metric', metricId: 'north-may-downtime' },
    };
    const computed = divideDecimal(
      subtractDecimal(juneDowntime.total, mayDowntime.total), mayDowntime.total,
    );
    metrics.push(compositeMetric('north-downtime-change', 'metric.downtimeChange', RATIO_UNIT, computed, juneNorth, juneNorthRows.rows.length, juneNorthRows.rows.length, 'north-downtime-change-proof'));
    provenance.push(compositeProof(ctx, 'north-downtime-change-proof', downtimeExpr, computed));
  }

  // Contribution and margin over the shared June mask.
  const moneyScale = Math.max(fractionScale(juneRevenue.total), fractionScale(juneCost.total));
  const contribution = formatScale(subtractDecimal(juneRevenue.total, juneCost.total), moneyScale);
  metrics.push(compositeMetric('june-contribution', 'metric.contribution', revenueCol.unit, contribution, juneAll, juneMask.length, juneAllRows.rows.length, 'june-contribution-proof'));
  provenance.push(compositeProof(ctx, 'june-contribution-proof', {
    op: 'subtract',
    left: { op: 'metric', metricId: 'june-revenue' },
    right: { op: 'metric', metricId: 'june-operating-cost' },
  }, contribution));
  if (compareDecimal(juneRevenue.total, '0') > 0) {
    const margin = divideDecimal(contribution, juneRevenue.total);
    metrics.push(compositeMetric('june-margin', 'metric.margin', RATIO_UNIT, margin, juneAll, juneMask.length, juneAllRows.rows.length, 'june-margin-proof'));
    provenance.push(compositeProof(ctx, 'june-margin-proof', {
      op: 'divide',
      left: { op: 'metric', metricId: 'june-contribution' },
      right: { op: 'metric', metricId: 'june-revenue' },
    }, margin));
  } else {
    metrics.push(undefinedMetric('june-margin', 'metric.margin', juneAll, juneMask.length, juneAllRows.rows.length, 'june-contribution-proof', 'metric.revenueNonPositive'));
  }

  // Quality trio: counts of ledger issues by kind.
  const qualityScope: Scope = {
    tableId: table.id,
    periodStart: null,
    periodEnd: null,
    regions: [],
    complete: true,
    coverageNoteKey: 'coverage.allSource',
  };
  const qualityDefs = [
    ['quality-duplicate', 'quality.duplicate', 'duplicate'],
    ['quality-category', 'quality.category', 'category'],
    ['quality-missing', 'quality.missing', 'missing'],
  ] as const;
  for (const [id, labelKey, kind] of qualityDefs) {
    const ids = table.qualityIssues.filter((q) => q.kind === kind).map((q) => q.id);
    const proofId = `${id}-proof`;
    metrics.push({
      id,
      labelKey,
      value: String(ids.length),
      status: 'defined',
      reasonKey: null,
      unit: { kind: 'count', label: 'records', currency: null },
      scope: qualityScope,
      eligibleRows: table.rows.length,
      totalRows: table.rows.length,
      provenanceId: proofId,
      warnings: [],
    });
    provenance.push({
      id: proofId,
      sourceRefs: [{ ...table.sourceRef }],
      selections: [],
      expression: { op: 'count-issues', issueIds: ids },
      result: String(ids.length),
      status: 'defined',
      reasonKey: null,
      policyVersion: POLICY.version,
      normalizationRevision: table.normalizationRevision,
      transformIds: [...ctx.resolved],
      precision: 40,
      rounding: 'ROUND_HALF_UP',
    });
  }

  const byId = new Map(metrics.map((m) => [m.id, m] as const));
  const findings: Finding[] = [];
  const minRows = POLICY.thresholds.minComparisonRows;

  // Divergence: orders up while revenue trails target, on distinct bases.
  if (
    gapValue !== null && ordersChange.value !== null &&
    compareDecimal(gapValue, `-${POLICY.thresholds.targetGapFraction}`) <= 0 &&
    compareDecimal(ordersChange.value, POLICY.thresholds.ordersIncreaseFraction) >= 0 &&
    pairMask.length >= minRows && juneNorthRows.rows.length >= minRows &&
    juneComplete && mayComplete
  ) {
    findings.push({
      id: 'finding-north-target',
      ruleId: 'north-target-orders-v1',
      kind: 'divergence',
      severity: 'attention',
      titleKey: 'finding.north.title',
      bodyKey: 'finding.north.body',
      metricIds: ['north-june-revenue', 'north-june-target', 'north-target-gap', 'north-orders-change'],
      provenanceIds: ['north-june-revenue-proof', 'north-june-target-proof', 'north-target-gap-proof', 'north-orders-change-proof'],
      qualityIssueIds: [],
      scope: juneNorth,
      rank: { classPriority: 1, coverage: '1', magnitude: absDecimal(gapValue) },
      chartId: 'chart-north-target',
      limitations: ['limitations.noCausality'],
    });
  }

  // Period change on downtime with prior-scope materiality.
  const mayAllRows = scopeRows(table, ctx.dateColumn, ctx.may, ctx.regionColumn, []);
  const mayAllDowntime = sumField(mayAllRows.rows, 'downtime_minutes');
  const materiality = divideDecimal(mayAllDowntime.total, '20');
  if (
    mayNorthRows.rows.length >= minRows && juneNorthRows.rows.length >= minRows &&
    compareDecimal(mayDowntime.total, '0') > 0 && juneComplete && mayComplete &&
    compareDecimal(absDecimal(downtimeValue), POLICY.thresholds.periodChangeFraction) >= 0 &&
    compareDecimal(absDecimal(downtimeChange.absolute), materiality) >= 0
  ) {
    findings.push({
      id: 'finding-north-downtime',
      ruleId: 'north-downtime-mom-v1',
      kind: 'period-change',
      severity: 'attention',
      titleKey: 'finding.downtime.title',
      bodyKey: 'finding.downtime.body',
      metricIds: ['north-may-downtime', 'north-june-downtime', 'north-downtime-change'],
      provenanceIds: ['north-may-downtime-proof', 'north-june-downtime-proof', 'north-downtime-change-proof'],
      qualityIssueIds: [],
      scope: juneNorth,
      rank: { classPriority: 2, coverage: '1', magnitude: downtimeValue },
      chartId: 'chart-downtime',
      limitations: ['limitations.noCausality'],
    });
  }

  // Quality ledger finding.
  if (table.qualityIssues.length > 0) {
    const ordered = [...table.qualityIssues].sort((a, b) =>
      (ACTION_ORDER[a.action] ?? 9) - (ACTION_ORDER[b.action] ?? 9)
      || a.sourceRow - b.sourceRow
      || (a.id < b.id ? -1 : 1),
    );
    findings.push({
      id: 'finding-quality',
      ruleId: 'quality-ledger-v1',
      kind: 'quality',
      severity: 'attention',
      titleKey: 'finding.quality.title',
      bodyKey: table.qualityIssues.some((q) => q.status === 'proposed')
        ? 'finding.quality.body.pending'
        : 'finding.quality.body',
      metricIds: ['quality-duplicate', 'quality-category', 'quality-missing'],
      provenanceIds: ['quality-duplicate-proof', 'quality-category-proof', 'quality-missing-proof'],
      qualityIssueIds: ordered.map((q) => q.id),
      scope: qualityScope,
      rank: { classPriority: 3, coverage: '1', magnitude: String(table.qualityIssues.length) },
      chartId: 'chart-quality',
      limitations: ['limitations.missingRetained'],
    });
  }

  // Lower-priority candidates are evaluated (and reported to tests) but lose
  // the three-finding cap to the decision-class rules above.
  const evaluatedTrends = evaluateTrends(table, scope);
  const evaluatedOutliers = evaluateOutliers(table, scope);
  void evaluatedTrends;
  void evaluatedOutliers;

  const charts: ChartSpec[] = [
    {
      id: 'chart-north-target',
      kind: 'target-bars',
      titleKey: 'chart.north.title',
      summaryKey: 'chart.north.summary',
      unit: { ...revenueCol.unit },
      series: [
        { id: 'actual', labelKey: 'common.actual', semantic: 'observed' },
        { id: 'target', labelKey: 'common.target', semantic: 'target' },
      ],
      points: [
        {
          key: 'north',
          labelKey: 'region.North',
          values: {
            actual: normalizeDecimalString(revenue.total),
            target: normalizeDecimalString(target.total),
          },
          metricIds: ['north-june-revenue', 'north-june-target'],
        },
      ],
      domain: { min: '0', max: domainMax([revenue.total, target.total]) },
      chronology: 'not-temporal',
      scope: juneNorth,
      provenanceIds: ['north-june-revenue-proof', 'north-june-target-proof'],
    },
    {
      id: 'chart-downtime',
      kind: 'bars',
      titleKey: 'chart.downtime.title',
      summaryKey: 'chart.downtime.summary',
      unit: { ...downtimeCol.unit },
      series: [{ id: 'actual', labelKey: 'common.actual', semantic: 'observed' }],
      points: [
        {
          key: '2026-05',
          labelKey: 'period.may',
          values: { actual: normalizeDecimalString(mayDowntime.total) },
          metricIds: ['north-may-downtime'],
        },
        {
          key: '2026-06',
          labelKey: 'period.june',
          values: { actual: normalizeDecimalString(juneDowntime.total) },
          metricIds: ['north-june-downtime'],
        },
      ],
      domain: { min: '0', max: domainMax([mayDowntime.total, juneDowntime.total]) },
      chronology: 'ltr',
      scope: juneNorth,
      provenanceIds: ['north-may-downtime-proof', 'north-june-downtime-proof'],
    },
    {
      id: 'chart-quality',
      kind: 'quality-bars',
      titleKey: 'chart.quality.title',
      summaryKey: 'chart.quality.summary',
      unit: { kind: 'count', label: 'records', currency: null },
      series: [{ id: 'issues', labelKey: 'quality.issues', semantic: 'attention' }],
      points: (['duplicate', 'category', 'missing'] as const).map((kind) => {
        const metric = byId.get(`quality-${kind}`) as Metric;
        return {
          key: kind,
          labelKey: `quality.${kind}`,
          values: { issues: metric.value as string },
          metricIds: [`quality-${kind}`],
        };
      }),
      domain: {
        min: '0',
        max: domainMax(
          (['duplicate', 'category', 'missing'] as const).map(
            (kind) => (byId.get(`quality-${kind}`) as Metric).value as string,
          ),
        ),
      },
      chronology: 'not-temporal',
      scope: qualityScope,
      provenanceIds: ['quality-duplicate-proof', 'quality-category-proof', 'quality-missing-proof'],
    },
  ];

  return {
    metrics,
    provenance,
    findings,
    charts,
    evaluatedTrends,
    evaluatedOutliers,
  };
}

/** Consecutive month periods ending with the scope month (oldest first). */
export function trailingMonths(endStart: string, count: number): Period[] {
  const year = Number(endStart.slice(0, 4));
  const month = Number(endStart.slice(5, 7));
  const out: Period[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const m = month - i;
    const y = year + Math.floor((m - 1) / 12);
    const mm = ((m - 1) % 12 + 12) % 12 + 1;
    const lastDay = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    const label = String(mm).padStart(2, '0');
    out.push({
      start: `${y}-${label}-01`,
      end: `${y}-${label}-${String(lastDay).padStart(2, '0')}`,
    });
  }
  return out;
}

/** Monthly region totals for an additive field (the 24-aggregate surface). */
export function summarizeMonthly(
  table: NormalizedTable,
  field: string,
  months: Period[],
): Array<{ region: string; period: string; total: string; rows: number }> {
  const dateColumn = findDateColumn(table);
  const regionColumn = findRegionColumn(table);
  if (dateColumn === null) return [];
  const regions = regionColumn === null
    ? ['__all__']
    : [...new Set(table.rows.map((r) => String(r.values[regionColumn.id] ?? '')))].sort();
  const out: Array<{ region: string; period: string; total: string; rows: number }> = [];
  for (const month of months) {
    const key = month.start.slice(0, 7);
    for (const region of regions) {
      const scoped = scopeRows(
        table, dateColumn, month, regionColumn, region === '__all__' ? [] : [region],
      );
      const sum = sumField(scoped.rows, field);
      out.push({ region, period: key, total: sum.total, rows: scoped.rows.length });
    }
  }
  return out;
}

/**
 * Four-period monotonic trends per region for currency measures.
 * Returns human-readable evaluations (below the finding cap in v1).
 */
export function evaluateTrends(table: NormalizedTable, scope: Scope): string[] {
  if (scope.periodStart === null) return [];
  const dateColumn = findDateColumn(table);
  const regionColumn = findRegionColumn(table);
  if (dateColumn === null || regionColumn === null) return [];
  const months = trailingMonths(scope.periodStart, POLICY.thresholds.trendMinPeriods);
  const measures = table.columns.filter(
    (c) => c.role === 'measure' && c.additive && c.confirmed && c.unit.kind === 'currency',
  );
  const out: string[] = [];
  for (const measure of measures) {
    const monthly = summarizeMonthly(table, measure.id, months);
    const totalsByRegion = new Map<string, string[]>();
    const completeByRegion = new Map<string, boolean>();
    for (const cell of monthly) {
      const period = months.find((m) => m.start.slice(0, 7) === cell.period) as Period;
      const complete = isPeriodComplete(table, dateColumn, period, scope.complete)
        && cell.rows > 0;
      if (!complete) {
        completeByRegion.set(cell.region, false);
        continue;
      }
      if (completeByRegion.get(cell.region) !== false) {
        completeByRegion.set(cell.region, true);
        const list = totalsByRegion.get(cell.region) ?? [];
        list.push(cell.total);
        totalsByRegion.set(cell.region, list);
      }
    }
    for (const [region, totals] of totalsByRegion) {
      if (completeByRegion.get(region) !== true || totals.length !== months.length) continue;
      const direction = trendDirection(totals);
      if (direction !== null) out.push(`${region}/${measure.id}:${direction}`);
    }
  }
  return out.sort();
}

/** Conservative outlier scan over current-scope integer groups. */
export function evaluateOutliers(table: NormalizedTable, scope: Scope): string[] {
  if (scope.periodStart === null || scope.periodEnd === null) return [];
  const dateColumn = findDateColumn(table);
  const regionColumn = findRegionColumn(table);
  if (dateColumn === null || regionColumn === null) return [];
  const period: Period = { start: scope.periodStart, end: scope.periodEnd };
  const regions = [...new Set(table.rows.map((r) => String(r.values[regionColumn.id] ?? '')))].sort();
  const measures = table.columns.filter(
    (c) => c.role === 'measure' && c.additive && c.confirmed && c.type === 'integer',
  );
  const out: string[] = [];
  for (const region of regions) {
    const scoped = scopeRows(table, dateColumn, period, regionColumn, [region]);
    for (const measure of measures) {
      const sum = sumField(scoped.rows, measure.id);
      if (sum.values.length < POLICY.thresholds.outlierMinRows) continue;
      for (const row of scoped.rows) {
        const value = row.values[measure.id];
        if (typeof value !== 'string' || !isDecimal(value)) continue;
        const verdict = iqrFlag(sum.values, value);
        if (verdict.eligible && verdict.flagged) {
          out.push(`${region}/${measure.id}@${row.sourceRow}=${value}`);
        }
      }
    }
  }
  return out.sort();
}
