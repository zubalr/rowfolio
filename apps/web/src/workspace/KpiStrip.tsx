import type { AnalysisSnapshot, Metric } from '@rowfolio/contracts';
import { Metric as MetricView, MetricStrip } from '@rowfolio/ui';
import { useI18n } from '../app/context.tsx';
import type { MessageKey } from '@rowfolio/i18n';
import { formatMetricValue, metricUnitLabel } from './format.ts';
import { duplicateLabelKeys } from './stageModel.ts';

const MAX_KPIS = 4;

/**
 * Headline metric strip — metrics claimed by the top finding first, then
 * remaining defined metrics, capped at four. Order is deterministic (the
 * snapshot's own ordering), never fabricated.
 *
 * Hierarchy cues: the lead metric renders feature-sized; every metric shows
 * its denominator (eligible of retained rows); when two metrics share a
 * label (e.g. Downtime for May and June) the reporting period suffix keeps
 * them distinct. Opaque units ("unit"/"fraction" placeholders and ratios
 * whose % is already in the value) don't render a badge.
 */
export function KpiStrip({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const i18n = useI18n();
  const ordered = headlineMetrics(snapshot);
  const dupes = duplicateLabelKeys(ordered);
  if (ordered.length === 0) return null;
  return (
    <MetricStrip label={i18n.tSafe('workspace.overview' as MessageKey)}>
      {ordered.map((metric, index) => {
        const baseLabel = i18n.tSafe(metric.labelKey as MessageKey);
        const period = dupes.has(metric.labelKey) ? metricPeriod(i18n, metric) : null;
        return (
          <MetricView
            key={metric.id}
            label={period === null ? baseLabel : `${baseLabel} · ${period}`}
            value={formatMetricValue(i18n, metric)}
            unit={displayUnit(metric)}
            status={metric.status}
            reasonLabel={metric.reasonKey ? i18n.tSafe(metric.reasonKey as MessageKey) : undefined}
            size={index === 0 ? 'feature' : 'rail'}
            footer={
              <span className="rf-metric-scope">
                {i18n.formatInteger(metric.eligibleRows)}
                {' / '}
                {i18n.plural('count.records' as MessageKey, metric.totalRows)}
              </span>
            }
            testId={`metric-${metric.id}`}
          />
        );
      })}
    </MetricStrip>
  );
}

function headlineMetrics(snapshot: AnalysisSnapshot): Metric[] {
  const claimed = new Set<string>();
  for (const finding of snapshot.findings.slice(0, 2)) {
    for (const id of finding.metricIds) claimed.add(id);
  }
  const byClaim: Metric[] = [];
  const rest: Metric[] = [];
  for (const metric of snapshot.metrics) {
    (claimed.has(metric.id) ? byClaim : rest).push(metric);
  }
  return [...byClaim, ...rest].slice(0, MAX_KPIS);
}

/**
 * Units worth printing beside the value: currency codes ("USD"), counts
 * ("records"), minutes. Ratios already carry % in the formatted value and
 * placeholder labels ("unit"/"fraction") carry nothing — both suppressed.
 */
function displayUnit(metric: Metric): Metric['unit'] | undefined {
  const label = metricUnitLabel(metric.unit);
  return label === null ? undefined : { ...metric.unit, label };
}

/** "May" / "May–Jun 2026" — the metric's own scope period, localized. */
function metricPeriod(i18n: ReturnType<typeof useI18n>, metric: Metric): string | null {
  const { periodStart, periodEnd } = metric.scope;
  if (periodStart === null || periodEnd === null) return null;
  if (periodStart.slice(0, 7) === periodEnd.slice(0, 7)) {
    return i18n.formatMonth(periodStart.slice(0, 7), { year: '2-digit' });
  }
  return i18n.formatDateRange(periodStart, periodEnd);
}
