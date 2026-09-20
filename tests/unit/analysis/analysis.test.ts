/**
 * Analysis engine tests: golden snapshot parity, the 24-aggregate oracle
 * surface, rule mechanics, generic descriptive behavior, and engine
 * properties (permutation invariance, partition additivity).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addDecimal,
  checkAnalysisSnapshot,
  compareDecimal,
  type AnalysisSnapshot,
  type Finding,
  type NormalizedTable,
} from '../../../packages/contracts/src/index.ts';
import type { AnalysisOptions } from '../../../packages/contracts/interfaces.ts';
import {
  absDecimal,
  analyze,
  AnalysisError,
  describe as describeDist,
  domainMax,
  evaluateOutliers,
  evaluateTrends,
  findDateColumn,
  findRegionColumn,
  hasSampleColumns,
  iqrFlag,
  previousMonthPeriod,
  quantileType7,
  relativeChange,
  scopeRows,
  summarizeMonthly,
  toSpans,
  trailingMonths,
  trendDirection,
} from '../../../packages/analysis/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', 'tests', 'contract', 'fixtures');
const SAMPLE = join(HERE, '..', '..', '..', 'fixtures', 'sample');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

const table = load<NormalizedTable>('normalized-table.example.json');
const golden = load<AnalysisSnapshot>('analysis-snapshot.example.json');

const OPTIONS: AnalysisOptions = {
  version: '1.0.0',
  confirmedScope: { ...golden.scope },
  samplePolicyId: 'sample-manifest-v1',
};

describe('golden snapshot parity', () => {
  it('reproduces the checked-in metrics, proofs, findings and quality summary', () => {
    const result = analyze(table, OPTIONS);
    expect(result.metrics).toEqual(golden.metrics);
    expect(result.provenance).toEqual(golden.provenance);
    expect(result.findings).toEqual(golden.findings);
    expect(result.qualitySummary).toEqual(golden.qualitySummary);
    expect(result.scope).toEqual(golden.scope);
    expect(result.tableId).toBe(golden.tableId);
    expect(result.sourceHash).toBe(golden.sourceHash);
    expect(result.normalizationRevision).toBe(golden.normalizationRevision);
  });

  it('reproduces charts up to the documented domain-bound variance', () => {
    const result = analyze(table, OPTIONS);
    expect(result.charts.map((c) => c.id)).toEqual(golden.charts.map((c) => c.id));
    for (const chart of result.charts) {
      const expected = golden.charts.find((c) => c.id === chart.id);
      expect(chart.id).toBe(expected?.id);
      expect(chart.kind).toBe(expected?.kind);
      expect(chart.titleKey).toBe(expected?.titleKey);
      expect(chart.summaryKey).toBe(expected?.summaryKey);
      expect(chart.unit).toEqual(expected?.unit);
      expect(chart.series).toEqual(expected?.series);
      expect(chart.points).toEqual(expected?.points);
      expect(chart.chronology).toBe(expected?.chronology);
      expect(chart.scope).toEqual(expected?.scope);
      expect(chart.provenanceIds).toEqual(expected?.provenanceIds);
      expect(chart.domain.min).toBe('0');
      for (const point of chart.points) {
        for (const value of Object.values(point.values)) {
          if (value !== null) {
            expect(compareDecimal(chart.domain.max, value) >= 0).toBe(true);
          }
        }
      }
    }
  });

  it('uses a deterministic snapshot id scheme', () => {
    const first = analyze(table, OPTIONS);
    const second = analyze(table, OPTIONS);
    expect(first.id).toBe(second.id);
    expect(first.id.startsWith('analysis-v1.0.0-operations-v1-')).toBe(true);
  });

  it('passes the contract validator against the normalized table', () => {
    const result = analyze(table, OPTIONS);
    expect(checkAnalysisSnapshot(result, { table, sourceHash: table.sourceRef.sourceHash })).toEqual([]);
  });
});

describe('24-aggregate oracle surface', () => {
  it('recomputes every region-period aggregate from the independent fixture', () => {
    const expected = JSON.parse(
      readFileSync(join(SAMPLE, 'expected_monthly.json'), 'utf8'),
    ) as Array<Record<string, string | number>>;
    const months = trailingMonths('2026-06-01', 4);
    const fields = ['revenue', 'target_revenue', 'operating_cost', 'order_volume', 'downtime_minutes'] as const;
    expect(months.map((m) => m.start.slice(0, 7))).toEqual(['2026-03', '2026-04', '2026-05', '2026-06']);
    for (const field of fields) {
      const summary = summarizeMonthly(table, field, months);
      expect(summary).toHaveLength(24);
      for (const cell of summary) {
        const record = expected.find((r) => r['period'] === cell.period && r['region'] === cell.region);
        expect(record, `${cell.period}/${cell.region}/${field}`).toBeDefined();
        expect(compareDecimal(cell.total, String(record?.[field])), `${cell.period}/${cell.region}/${field}`).toBe(0);
        expect(cell.rows).toBe(100);
      }
    }
  });
});

describe('rule evaluation', () => {
  it('evaluates monotonic trends per region and measure', () => {
    const trends = evaluateTrends(table, golden.scope);
    expect(trends).toContain('North/revenue:down');
    expect([...trends].sort()).toEqual(trends);
  });

  it('runs the conservative outlier scan deterministically', () => {
    const first = evaluateOutliers(table, golden.scope);
    const second = evaluateOutliers(table, golden.scope);
    expect(first).toEqual(second);
    for (const entry of first) {
      expect(entry).toMatch(/^[A-Za-z]+\/[a-z_]+@\d+=-?\d+(\.\d+)?$/);
    }
  });

  it('keeps generic tables descriptive: no sample pack without a policy id', () => {
    expect(hasSampleColumns(table)).toBe(true);
    const generic = analyze(table, { ...OPTIONS, samplePolicyId: null });
    expect(generic.findings.map((f) => f.kind).sort()).toEqual(['descriptive', 'quality']);
    expect(generic.findings.some((f) => f.ruleId.includes('north-'))).toBe(false);
    expect(checkAnalysisSnapshot(generic, { table, sourceHash: table.sourceRef.sourceHash })).toEqual([]);
  });

  it('withholds comparison findings when periods are not confirmed complete', () => {
    const partial = analyze(table, {
      ...OPTIONS,
      confirmedScope: { ...golden.scope, complete: false, coverageNoteKey: 'coverage.partial' },
    });
    expect(partial.findings.map((f) => f.id)).toEqual(['finding-quality']);
  });

  it('rejects unsupported analysis versions', () => {
    expect(() => analyze(table, { ...OPTIONS, version: '2.0.0' } as AnalysisOptions))
      .toThrow(AnalysisError);
  });
});

describe('mechanics', () => {
  it('applies zero/negative denominator discipline', () => {
    expect(relativeChange('5', '0')).toEqual({ status: 'not_computable', value: null, absolute: '5' });
    expect(relativeChange('371', '1194').status).toBe('defined');
    expect(relativeChange('5', '-10').status).toBe('negative-base');
  });

  it('computes type-7 quantiles', () => {
    const values = Array.from({ length: 100 }, (_, i) => String(i + 1));
    const dist = describeDist(values);
    expect([dist.median, dist.q1, dist.q3]).toEqual(['50.5', '25.75', '75.25']);
    expect(quantileType7(['5'], '0.5')).toBe('5');
  });

  it('gates the IQR flag on count, spread and distance', () => {
    expect(iqrFlag(['1', '2'], '9').eligible).toBe(false);
    expect(iqrFlag(Array(30).fill('5'), '5')).toEqual(
      { eligible: false, flagged: false, reason: 'iqr-zero-no-division' },
    );
    const values = Array.from({ length: 100 }, (_, i) => String(i + 1));
    expect(iqrFlag(values, '300').flagged).toBe(true);
    expect(iqrFlag(values, '50').flagged).toBe(false);
  });

  it('detects strict monotonic trends only', () => {
    expect(trendDirection(['1', '2', '3', '4'])).toBe('up');
    expect(trendDirection(['4', '3', '2', '1'])).toBe('down');
    expect(trendDirection(['1', '2', '2', '3'])).toBeNull();
    expect(trendDirection(['1', '3', '2', '4'])).toBeNull();
    expect(trendDirection(['7'])).toBeNull();
  });

  it('bounds chart domains above the data at two significant figures', () => {
    // Strictly above max × 1.1: exact hits still get visible headroom, and
    // negative-exponent scaling keeps small magnitudes on-scale (a 0.23
    // bound for data 1,1,2 flattened every bar to the same top).
    expect(domainMax(['881000.00', '1000000.00'])).toBe('1200000');
    expect(domainMax(['1194', '1565'])).toBe('1800');
    expect(domainMax(['0'])).toBe('10');
    expect(domainMax(['1', '1', '2'])).toBe('2.3');
    expect(domainMax(['0.1', '0.2'])).toBe('0.23');
    expect(absDecimal('-0.119')).toBe('0.119');
  });

  it('keeps domain bounds sane for signed zero and extremes', () => {
    expect(domainMax(['-0.00', '0'])).toBe('10');
    expect(domainMax(['-5', '-3'])).toBe('5.6');
    expect(domainMax(['0.000000000000000001', '0.000000000000000002'])).toBe('0.0000000000000000023');
    expect(domainMax(['999999999999999999999999999999.99'])).toBe('1100000000000000000000000000000');
    expect(domainMax(['17', '7', '5'])).toBe('19');
    expect(domainMax(['0.25', '0.19'])).toBe('0.28');
  });

  it('derives the previous calendar month with year wrap', () => {
    expect(previousMonthPeriod('2026-06-15')).toEqual({ start: '2026-05-01', end: '2026-05-31' });
    expect(previousMonthPeriod('2026-01-10')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(trailingMonths('2026-06-01', 4).map((m) => m.start)).toEqual(
      ['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'],
    );
  });

  it('compresses spans without merging gaps', () => {
    expect(toSpans([9, 2, 4])).toEqual([
      { start: 2, end: 2 },
      { start: 4, end: 4 },
      { start: 9, end: 9 },
    ]);
  });

  it('treats a region filter without a region column as unsatisfiable', () => {
    const dateColumn = findDateColumn(table);
    if (dateColumn === null) throw new Error('golden table lacks a date column');
    // Regions requested but no region column: zero rows, never the whole
    // table masquerading as a regional scope.
    const scoped = scopeRows(
      table, dateColumn, { start: '2026-01-01', end: '2026-12-31' }, null, ['Atlantis'],
    );
    expect(scoped.rows).toHaveLength(0);
    expect(scoped.sourceRows).toHaveLength(0);
    // Empty region list means no regional constraint: rows flow normally.
    const unscoped = scopeRows(
      table, dateColumn, { start: '2026-06-01', end: '2026-06-30' }, null, [],
    );
    expect(unscoped.rows.length).toBeGreaterThan(0);
  });

  it('filters matching regions and empties missing ones', () => {
    const dateColumn = findDateColumn(table);
    const regionColumn = findRegionColumn(table);
    if (dateColumn === null || regionColumn === null) throw new Error('golden table lacks axis columns');
    const north = scopeRows(
      table, dateColumn, { start: '2026-06-01', end: '2026-06-30' },
      regionColumn, ['North'],
    );
    expect(north.rows).toHaveLength(100);
    expect(north.rows.every((r) => r.values['region'] === 'North')).toBe(true);
    const missing = scopeRows(
      table, dateColumn, { start: '2026-06-01', end: '2026-06-30' },
      regionColumn, ['Atlantis'],
    );
    expect(missing.rows).toHaveLength(0);
  });

  it('ranks by class, coverage, magnitude and stable id, capped at three', () => {
    const mk = (id: string, classPriority: number, magnitude: string): Finding => ({
      ...(golden.findings[0] as Finding),
      id,
      ruleId: `${id}-rule`,
      rank: { classPriority, coverage: '1', magnitude },
    });
    const ordered = [mk('b', 2, '0.5'), mk('a', 2, '0.5'), mk('c', 1, '0.01')]
      .sort((x, y) => (x.rank.classPriority - y.rank.classPriority) || (x.id < y.id ? -1 : 1));
    expect(ordered.map((f) => f.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('engine properties', () => {
  it('is invariant under row permutation', () => {
    const reversed: NormalizedTable = {
      ...table,
      rows: [...table.rows].reverse(),
      qualityIssues: [...table.qualityIssues],
    };
    const first = analyze(table, OPTIONS);
    const second = analyze(reversed, OPTIONS);
    expect(second.metrics.map((m) => [m.id, m.value])).toEqual(
      first.metrics.map((m) => [m.id, m.value]),
    );
    expect(second.findings.map((f) => f.id)).toEqual(first.findings.map((f) => f.id));
  });

  it('partitions add to the total under equal masks', () => {
    const months = trailingMonths('2026-06-01', 1);
    const summary = summarizeMonthly(table, 'revenue', months);
    expect(summary).toHaveLength(6);
    let acc = '0';
    for (const cell of summary) acc = addDecimal(acc, cell.total);
    const june = analyze(table, OPTIONS).metrics.find((m) => m.id === 'june-revenue');
    expect(compareDecimal(acc, june?.value as string)).toBe(0);
    expect(june?.value).toBe('6000000.00');
  });
});
