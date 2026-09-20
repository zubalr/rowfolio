import type { AnalysisSnapshot, Finding, Metric } from '@rowfolio/contracts';
import type { I18n } from '@rowfolio/i18n';
import { formatDecimal, formatPercentAbs } from './format.ts';

/**
 * Placeholder resolution for finding body copy. Every placeholder maps to a
 * metric the finding already claims (finding.metricIds) — nothing invented.
 * Unresolvable params are omitted (t() leaves them literal rather than
 * fabricating values); a diagnostic path notes them in dev.
 */
const PARAM_PLAN: Record<string, readonly { param: string; metricId: string; format: 'unit' | 'percent' | 'percent-abs' }[]> = {
  'finding.north.body': [
    { param: 'gap', metricId: 'north-target-gap', format: 'percent-abs' },
    { param: 'orders', metricId: 'north-orders-change', format: 'percent' },
  ],
  'finding.downtime.body': [
    { param: 'change', metricId: 'north-downtime-change', format: 'percent' },
    { param: 'previous', metricId: 'north-may-downtime', format: 'unit' },
    { param: 'current', metricId: 'north-june-downtime', format: 'unit' },
  ],
  'finding.quality.body': [
    { param: 'duplicates', metricId: 'quality-duplicate', format: 'unit' },
    { param: 'categories', metricId: 'quality-category', format: 'unit' },
    { param: 'missing', metricId: 'quality-missing', format: 'unit' },
  ],
};

export function findingTitle(i18n: I18n, finding: Finding): string {
  return i18n.tSafe(finding.titleKey as never);
}

export function findingBody(i18n: I18n, snapshot: AnalysisSnapshot, finding: Finding): string {
  const plan = PARAM_PLAN[finding.bodyKey];
  const params: Record<string, string> = {};
  if (plan) {
    const metrics = new Map<string, Metric>(snapshot.metrics.map((m) => [m.id, m]));
    for (const { param, metricId, format } of plan) {
      const metric = metrics.get(metricId);
      if (!metric || metric.value === null) continue;
      if (!finding.metricIds.includes(metricId)) continue; // honesty: only claimed metrics
      params[param] =
        format === 'percent' ? i18n.formatPercent(metric.value, { maxFractionDigits: 1 })
        : format === 'percent-abs' ? formatPercentAbs(i18n, metric.value, { maxFractionDigits: 1 })
        : formatDecimal(i18n, metric.value, metric.unit);
    }
  }
  return i18n.tSafe(finding.bodyKey as never, params);
}

/** `finding-north-target` → `finding-north` — the stable test hook prefix. */
export function findingTestId(finding: Finding): string {
  const parts = finding.id.split('-');
  return parts.length > 1 ? `finding-${parts[1]}` : finding.id;
}
