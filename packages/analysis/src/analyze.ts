/**
 * Deterministic analysis orchestrator: builds an immutable
 * AnalysisSnapshot from a normalized table and a confirmed scope.
 *
 * With a sample policy id and the sample's confirmed columns, the
 * versioned sample rule pack runs. Otherwise the engine stays
 * descriptive: confirmed additive measures are summed, the quality
 * ledger is counted, and no management advice is invented. Findings are
 * ranked by the specified tuple and capped at three.
 */
import { compareDecimal, isDecimal, isTranslationKey, POLICY } from '@rowfolio/contracts';
import type {
  AnalysisSnapshot,
  ChartSpec,
  Finding,
  Metric,
  NormalizedTable,
  Provenance,
  Scope,
} from '@rowfolio/contracts';
import { domainMax } from './mechanics.ts';
import { formatScale } from './sample.ts';
import {
  buildSamplePack,
  hasSampleColumns,
  SamplePackError,
} from './sample.ts';
import {
  findDateColumn,
  findRegionColumn,
  scopeRows,
  sumField,
  toSpans,
} from './scope.ts';

export class AnalysisError extends Error {
  readonly code: 'unsupported-version' | 'sample-pack';
  constructor(code: AnalysisError['code'], message: string) {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

/**
 * Analysis options. Structural mirror of the contract `AnalysisOptions`
 * interface (deep workspace imports are forbidden by repo convention).
 */
export interface AnalysisOptions {
  readonly version: '1.0.0';
  readonly confirmedScope: Scope;
  readonly samplePolicyId: string | null;
}

/** Rank key: class priority, then coverage and magnitude (descending), then stable id. */
export function compareFindings(a: Finding, b: Finding): number {
  if (a.rank.classPriority !== b.rank.classPriority) {
    return a.rank.classPriority - b.rank.classPriority;
  }
  const coverage = compareDecimal(b.rank.coverage, a.rank.coverage);
  if (coverage !== 0) return coverage;
  const magnitude = compareDecimal(b.rank.magnitude, a.rank.magnitude);
  if (magnitude !== 0) return magnitude;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function topFindings(findings: readonly Finding[], limit = 3): Finding[] {
  return [...findings].sort(compareFindings).slice(0, limit);
}

export function qualitySummaryOf(table: NormalizedTable): AnalysisSnapshot['qualitySummary'] {
  const { range, headerRow } = table.sourceRef;
  const span = range.lastRow - range.firstRow + 1;
  const rawRows = span - (headerRow >= range.firstRow && headerRow <= range.lastRow ? 1 : 0);
  return {
    rawRows,
    retainedRows: table.rows.length,
    issueCount: table.qualityIssues.length,
    resolved: table.qualityIssues.filter((q) => q.status === 'resolved').length,
    unresolved: table.qualityIssues.filter((q) => q.status === 'unresolved').length,
  };
}

export function snapshotId(table: NormalizedTable, scope: AnalysisSnapshot['scope']): string {
  const period = `${scope.periodStart ?? 'all'}-${scope.periodEnd ?? 'all'}`;
  const regions = scope.regions.length > 0 ? scope.regions.join('+') : 'all';
  return `analysis-v1.0.0-${table.id}-${period}-${regions}`;
}

function genericMetrics(
  table: NormalizedTable,
  scope: AnalysisSnapshot['scope'],
): { metrics: Metric[]; provenance: Provenance[] } {
  const metrics: Metric[] = [];
  const provenance: Provenance[] = [];
  const dateColumn = findDateColumn(table);
  const regionColumn = findRegionColumn(table);
  const inScope = dateColumn !== null && scope.periodStart !== null && scope.periodEnd !== null
    ? scopeRows(
      table,
      dateColumn,
      { start: scope.periodStart, end: scope.periodEnd },
      regionColumn,
      scope.regions,
    ).rows
    : table.rows;
  const resolved = table.qualityIssues.filter((q) => q.status === 'resolved').map((q) => q.id);
  // Confirmed measures participate even when the column leans mixed:
  // confirmation is the semantic gate, per-value decimal validity the rest.
  // Exportable metrics additionally need a declared catalog key: the
  // contract rejects invented `metric.*` labels, so measures without one
  // stay in the table but get no metric (a catalog gap, not silent math).
  const measures = table.columns.filter(
    (c) => c.role === 'measure' && c.additive && c.confirmed
      && (c.type === 'decimal' || c.type === 'integer' || c.type === 'mixed')
      && isTranslationKey(`metric.${c.id}`),
  );
  for (const column of measures) {
    const sum = sumField(inScope, column.id);
    const id = `total-${column.id}`;
    const proofId = `${id}-proof`;
    let scale = 0;
    for (const value of sum.values) {
      const dot = value.indexOf('.');
      if (dot !== -1) scale = Math.max(scale, value.length - dot - 1);
    }
    const value = formatScale(sum.total, scale);
    const sourceRows = inScope
      .filter((r) => typeof r.values[column.id] === 'string' && isDecimal(r.values[column.id] as string))
      .map((r) => r.sourceRow);
    const spanSet = new Set(sourceRows);
    const excludedRowIds = table.qualityIssues
      .filter(
        (q) => q.kind === 'duplicate' && q.status === 'resolved'
          && q.canonicalSourceRow !== null && spanSet.has(q.canonicalSourceRow),
      )
      .map((q) => `${table.sourceRef.sheetId}:R${q.sourceRow}`)
      .sort();
    metrics.push({
      id,
      labelKey: `metric.${column.id}`,
      value,
      status: 'defined',
      reasonKey: null,
      unit: { ...column.unit },
      scope: { ...scope },
      eligibleRows: sum.eligible,
      totalRows: inScope.length,
      provenanceId: proofId,
      warnings: table.qualityIssues.some(
        (q) => q.kind === 'formula-cache' && q.status === 'resolved' && q.fieldId === column.id,
      )
        ? ['limitations.cache']
        : [],
    });
    provenance.push({
      id: proofId,
      sourceRefs: [{ ...table.sourceRef }],
      selections: [
        {
          id: `${id}-rows`,
          sourceRefId: table.sourceRef.id,
          spans: toSpans(sourceRows),
          rowCount: sourceRows.length,
          fieldIds: [column.id],
          excludedRowIds,
          maskPolicy: 'shared-valid',
        },
      ],
      expression: { op: 'sum', selectionId: `${id}-rows`, fieldId: column.id },
      result: value,
      status: 'defined',
      reasonKey: null,
      policyVersion: POLICY.version,
      normalizationRevision: table.normalizationRevision,
      transformIds: [...resolved],
      precision: 40,
      rounding: 'ROUND_HALF_UP',
    });
  }
  const qualityScope: AnalysisSnapshot['scope'] = {
    tableId: table.id,
    periodStart: null,
    periodEnd: null,
    regions: [],
    complete: true,
    coverageNoteKey: 'coverage.allSource',
  };
  for (const [id, labelKey, kind] of [
    ['quality-duplicate', 'quality.duplicate', 'duplicate'],
    ['quality-category', 'quality.category', 'category'],
    ['quality-missing', 'quality.missing', 'missing'],
  ] as const) {
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
      transformIds: [...resolved],
      precision: 40,
      rounding: 'ROUND_HALF_UP',
    });
  }
  return { metrics, provenance };
}

function genericFindings(
  table: NormalizedTable,
  scope: AnalysisSnapshot['scope'],
  metrics: readonly Metric[],
): Finding[] {
  const findings: Finding[] = [];
  if (table.qualityIssues.length > 0) {
    findings.push({
      id: 'finding-quality',
      ruleId: 'quality-ledger-v1',
      kind: 'quality',
      severity: 'attention',
      titleKey: 'finding.quality.title',
      // Proposed-but-unapplied issues mean the row-level fixes did not run:
      // the body must say "flagged", not "excluded".
      bodyKey: table.qualityIssues.some((q) => q.status === 'proposed')
        ? 'finding.quality.body.pending'
        : 'finding.quality.body',
      metricIds: ['quality-duplicate', 'quality-category', 'quality-missing'],
      provenanceIds: ['quality-duplicate-proof', 'quality-category-proof', 'quality-missing-proof'],
      qualityIssueIds: table.qualityIssues.map((q) => q.id),
      scope: {
        tableId: table.id,
        periodStart: null,
        periodEnd: null,
        regions: [],
        complete: true,
        coverageNoteKey: 'coverage.allSource',
      },
      rank: { classPriority: 3, coverage: '1', magnitude: String(table.qualityIssues.length) },
      chartId: 'chart-quality',
      limitations: ['limitations.missingRetained'],
    });
  }
  const totals = metrics.filter((m) => m.id.startsWith('total-'));
  findings.push({
    id: 'finding-descriptive',
    ruleId: 'generic-descriptive-v1',
    kind: 'descriptive',
    severity: 'neutral',
    titleKey: 'finding.descriptive.title',
    bodyKey: 'finding.descriptive.body',
    metricIds: totals.map((m) => m.id),
    provenanceIds: totals.map((m) => m.provenanceId),
    qualityIssueIds: [],
    scope: { ...scope },
    rank: { classPriority: 4, coverage: '1', magnitude: '0' },
    chartId: null,
    limitations: [],
  });
  return findings;
}

function genericCharts(
  table: NormalizedTable,
  metrics: readonly Metric[],
): ChartSpec[] {
  if (table.qualityIssues.length === 0) return [];
  const byId = new Map(metrics.map((m) => [m.id, m] as const));
  const kinds = ['duplicate', 'category', 'missing'] as const;
  return [
    {
      id: 'chart-quality',
      kind: 'quality-bars',
      titleKey: 'chart.quality.title',
      // The sample's summary cites its fixed ledger counts; arbitrary uploads
      // get a count-free summary — the bars carry the real numbers.
      summaryKey: 'chart.quality.summary.generic',
      unit: { kind: 'count', label: 'records', currency: null },
      series: [{ id: 'issues', labelKey: 'quality.issues', semantic: 'attention' }],
      points: kinds.map((kind) => ({
        key: kind,
        labelKey: `quality.${kind}`,
        values: { issues: (byId.get(`quality-${kind}`)?.value ?? '0') as string },
        metricIds: [`quality-${kind}`],
      })),
      domain: {
        min: '0',
        max: domainMax(kinds.map((kind) => (byId.get(`quality-${kind}`)?.value ?? '0') as string)),
      },
      chronology: 'not-temporal',
      scope: {
        tableId: table.id,
        periodStart: null,
        periodEnd: null,
        regions: [],
        complete: true,
        coverageNoteKey: 'coverage.allSource',
      },
      provenanceIds: kinds.map((kind) => `quality-${kind}-proof`),
    },
  ];
}

export function analyze(table: NormalizedTable, options: AnalysisOptions): AnalysisSnapshot {
  if (options.version !== '1.0.0') {
    throw new AnalysisError('unsupported-version', `unsupported analysis version ${JSON.stringify(options.version)}`);
  }
  const scope: AnalysisSnapshot['scope'] = { ...options.confirmedScope };
  const useSamplePack = options.samplePolicyId !== null && hasSampleColumns(table);

  let metrics: Metric[];
  let provenance: Provenance[];
  let findings: Finding[];
  let charts: ChartSpec[];
  if (useSamplePack) {
    try {
      const pack = buildSamplePack(table, scope);
      metrics = [...pack.metrics];
      provenance = [...pack.provenance];
      findings = topFindings(pack.findings);
      charts = [...pack.charts];
    } catch (error) {
      if (error instanceof SamplePackError) {
        throw new AnalysisError('sample-pack', error.message);
      }
      throw error;
    }
  } else {
    const generic = genericMetrics(table, scope);
    metrics = generic.metrics;
    provenance = generic.provenance;
    findings = topFindings(genericFindings(table, scope, metrics));
    charts = genericCharts(table, metrics);
  }

  // Findings already carry explicit rank tuples; the cap is contractual.
  return {
    schemaVersion: '1.0.0',
    id: snapshotId(table, scope),
    tableId: table.id,
    sourceHash: table.sourceRef.sourceHash,
    normalizationRevision: table.normalizationRevision,
    analysisVersion: '1.0.0',
    scope,
    metrics,
    findings,
    provenance,
    charts,
    qualitySummary: qualitySummaryOf(table),
  };
}
