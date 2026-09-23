/**
 * Stage model — pure display derivations for the chart stage and the scenario
 * exhibit. Nothing here recomputes metrics: the emphasis key resolves which
 * declared datum a finding points at, and the scenario ChartSpec only
 * re-packages committed engine values for the existing scenario-bars kind.
 */
import {
  compareDecimal,
  multiplyDecimal,
  type AnalysisSnapshot,
  type ChartSpec,
  type Finding,
  type Metric,
  type ScenarioResult,
} from '@rowfolio/contracts';

/**
 * The datum the finding is about: its chart points declare `metricIds`, the
 * finding declares the metrics it claims. Temporal charts mark the latest
 * matched period (the movement is the story); categorical charts mark the
 * first (the lead figure). A finding with no claimed datum leaves the chart
 * unmarked — never fall back to an arbitrary point.
 */
export function emphasisKeyFor(spec: ChartSpec, finding: Finding | null): string | undefined {
  const wanted = new Set(finding?.metricIds ?? []);
  const matches = spec.points.filter((p) => p.metricIds.some((id) => wanted.has(id)));
  if (matches.length === 0) return undefined;
  return spec.chronology === 'ltr' ? matches[matches.length - 1]!.key : matches[0]!.key;
}

/** The finding whose chart this is — charts and findings link by chartId. */
export function chartFinding(snapshot: AnalysisSnapshot, chartId: string): Finding | null {
  return snapshot.findings.find((f) => f.chartId === chartId) ?? null;
}

/** The chart a selected finding leads with, else the first declared chart. */
export function heroChart(snapshot: AnalysisSnapshot, finding: Finding | null): ChartSpec | null {
  const byFinding = finding === null ? undefined : snapshot.charts.find((c) => c.id === finding.chartId);
  return byFinding ?? snapshot.charts[0] ?? null;
}

/**
 * Committed scenario → `scenario-bars` spec: baseline margin vs scenario
 * margin on a FIXED domain derived from the committed baseline (the axis
 * never rescales between submissions, so resubmits never exaggerate the
 * delta). Returns null rather than rendering a misleading comparison when
 * the pairing inputs are absent or non-ratio.
 */
export function scenarioChartSpec(
  snapshot: AnalysisSnapshot,
  scenario: ScenarioResult,
): ChartSpec | null {
  const baseline = snapshot.metrics.find((m) => m.labelKey === 'metric.margin');
  const scenarioMargin = scenario.metrics.find((m) => m.labelKey === 'metric.margin');
  if (baseline?.value == null || scenarioMargin?.value == null) return null;
  if (baseline.unit.kind !== 'ratio' || scenarioMargin.unit.kind !== 'ratio') return null;
  if (compareDecimal(baseline.value, '0') <= 0) return null;
  return {
    id: 'chart-scenario',
    kind: 'scenario-bars',
    titleKey: 'chart.scenario.title',
    summaryKey: 'scenario.assumption.mechanical',
    unit: { kind: 'ratio', label: '%', currency: null },
    series: [{ id: 'margin', labelKey: 'metric.margin', semantic: 'observed' }],
    points: [
      {
        key: 'baseline',
        labelKey: 'common.baseline',
        values: { margin: baseline.value },
        metricIds: [baseline.id],
      },
      {
        key: 'scenario',
        labelKey: 'common.scenario',
        values: { margin: scenarioMargin.value },
        metricIds: [scenarioMargin.id],
      },
    ],
    // Fixed: 1.5× the committed baseline — stable across scenario resubmits.
    domain: { min: '0', max: multiplyDecimal(baseline.value, '1.5') },
    chronology: 'not-temporal',
    scope: scenario.scope,
    provenanceIds: [...new Set([baseline.provenanceId, ...scenario.provenance.map((p) => p.id)])],
  };
}

/** Metric labels identical in the strip need their period to disambiguate. */
export function duplicateLabelKeys(metrics: readonly Metric[]): Set<string> {
  const counts = new Map<string, number>();
  for (const m of metrics) counts.set(m.labelKey, (counts.get(m.labelKey) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([key]) => key));
}
