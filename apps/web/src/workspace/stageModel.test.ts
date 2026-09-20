import { describe, expect, it } from 'vitest';
import type { AnalysisSnapshot, ScenarioResult } from '@rowfolio/contracts';
import { emphasisKeyFor, heroChart, scenarioChartSpec } from './stageModel.ts';

import snapshotFixture from '../../../../tests/contract/fixtures/analysis-snapshot.example.json';
import scenarioFixture from '../../../../tests/contract/fixtures/scenario-result.example.json';

const SNAPSHOT = snapshotFixture as unknown as AnalysisSnapshot;
const SCENARIO = scenarioFixture as unknown as ScenarioResult;

describe('emphasisKeyFor', () => {
  it('marks the latest matched period on temporal charts', () => {
    const downtime = SNAPSHOT.charts.find((c) => c.id === 'chart-downtime')!;
    const finding = SNAPSHOT.findings.find((f) => f.id === 'finding-north-downtime')!;
    expect(emphasisKeyFor(downtime, finding)).toBe('2026-06');
  });

  it('marks the first matched point on categorical charts', () => {
    const quality = SNAPSHOT.charts.find((c) => c.id === 'chart-quality')!;
    const finding = SNAPSHOT.findings.find((f) => f.id === 'finding-quality')!;
    expect(emphasisKeyFor(quality, finding)).toBe('duplicate');
  });

  it('leaves unrelated charts unmarked', () => {
    const downtime = SNAPSHOT.charts.find((c) => c.id === 'chart-downtime')!;
    const quality = SNAPSHOT.findings.find((f) => f.id === 'finding-quality')!;
    expect(emphasisKeyFor(downtime, quality)).toBeUndefined();
    expect(emphasisKeyFor(downtime, null)).toBeUndefined();
  });
});

describe('heroChart', () => {
  it('leads with the selected finding’s chart', () => {
    const finding = SNAPSHOT.findings.find((f) => f.id === 'finding-quality')!;
    expect(heroChart(SNAPSHOT, finding)?.id).toBe('chart-quality');
  });

  it('falls back to the first declared chart', () => {
    expect(heroChart(SNAPSHOT, null)?.id).toBe(SNAPSHOT.charts[0]!.id);
  });
});

describe('scenarioChartSpec', () => {
  it('builds a ratio scenario-bars spec on a fixed baseline-derived domain', () => {
    const spec = scenarioChartSpec(SNAPSHOT, SCENARIO);
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe('scenario-bars');
    expect(spec!.points.map((p) => p.key)).toEqual(['baseline', 'scenario']);
    // Domain is fixed by the committed baseline (0.25 × 1.5), not the scenario value.
    expect(spec!.domain).toEqual({ min: '0', max: '0.375' });
    expect(spec!.points[0]!.values['margin']).toBe('0.25');
    expect(spec!.provenanceIds.length).toBeGreaterThan(0);
  });

  it('refuses when the baseline margin cannot anchor the axis', () => {
    const noMargin = {
      ...SNAPSHOT,
      metrics: SNAPSHOT.metrics.filter((m) => m.labelKey !== 'metric.margin'),
    };
    expect(scenarioChartSpec(noMargin, SCENARIO)).toBeNull();
  });
});
