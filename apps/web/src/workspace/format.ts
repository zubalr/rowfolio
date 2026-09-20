import type { Decimal, Metric, Unit } from '@rowfolio/contracts';
import type { I18n } from '@rowfolio/i18n';

/** Format a canonical decimal for display by unit kind. Presentation only. */
export function formatDecimal(i18n: I18n, value: Decimal, unit: Unit): string {
  switch (unit.kind) {
    case 'currency':
      return unit.currency ? i18n.formatCurrency(value, unit.currency) : i18n.formatNumber(value);
    case 'ratio':
      return i18n.formatPercent(value);
    case 'count':
    case 'minutes':
    case 'percentage-point':
    case 'score':
      return i18n.formatInteger(value);
    default:
      return i18n.formatNumber(value);
  }
}

export function formatMetricValue(i18n: I18n, metric: Metric): string | null {
  if (metric.status !== 'defined' || metric.value === null) return null;
  return formatDecimal(i18n, metric.value, metric.unit);
}

/** Integer count in the active digits (file sizes use SI bytes via formatNumber). */
export function formatInteger(i18n: I18n, value: number | Decimal): string {
  return i18n.formatInteger(value);
}

export function formatPercentAbs(i18n: I18n, value: Decimal): string {
  return i18n.formatPercent(stripSign(value));
}

function stripSign(value: Decimal): Decimal {
  return value.startsWith('-') ? (value.slice(1) as Decimal) : value;
}
