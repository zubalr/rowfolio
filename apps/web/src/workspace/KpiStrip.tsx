import type { AnalysisSnapshot, Metric } from '@rowfolio/contracts';
import { Metric as MetricView, MetricStrip } from '@rowfolio/ui';
import { useI18n } from '../app/context.tsx';
import type { MessageKey } from '@rowfolio/i18n';
import { formatMetricValue } from './format.ts';

const MAX_KPIS = 4;

/**
 * Headline metric strip — metrics claimed by the top finding first, then
 * remaining defined metrics, capped at four. Order is deterministic (the
 * snapshot's own ordering), never fabricated.
 */
export function KpiStrip({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const i18n = useI18n();
  const ordered = headlineMetrics(snapshot);
  if (ordered.length === 0) return null;
  return (
    <MetricStrip label={i18n.tSafe('workspace.overview' as MessageKey)}>
      {ordered.map((metric) => (
        <MetricView
          key={metric.id}
          label={i18n.tSafe(metric.labelKey as MessageKey)}
          value={formatMetricValue(i18n, metric)}
          unit={metric.unit.kind === 'unknown' ? undefined : metric.unit}
          status={metric.status}
          reasonLabel={metric.reasonKey ? i18n.tSafe(metric.reasonKey as MessageKey) : undefined}
        />
      ))}
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
