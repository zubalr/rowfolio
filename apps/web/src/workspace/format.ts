import type { Decimal, Metric, Unit } from '@rowfolio/contracts';
import { toDecimal, type I18n, type NumberFormatOptions } from '@rowfolio/i18n';

/** Format a canonical decimal for display by unit kind. Presentation only. */
export function formatDecimal(i18n: I18n, value: Decimal, unit: Unit): string {
  switch (unit.kind) {
    case 'currency':
      return unit.currency ? i18n.formatCurrency(value, unit.currency) : i18n.formatNumber(value);
    case 'ratio':
      return i18n.formatPercent(value);
    case 'percentage-point':
      // Deltas are frequently fractional (e.g. -3.75 pp) — integer formatting
      // would throw; canonical decimals render exactly via formatNumber.
      return i18n.formatNumber(value);
    case 'count':
    case 'minutes':
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

export function formatPercentAbs(
  i18n: I18n,
  value: Decimal,
  options?: NumberFormatOptions,
): string {
  // Validate canonical decimal form before stripping the sign — malformed
  // input must throw, never silently format ('--1' ≠ '1').
  return i18n.formatPercent(stripSign(toDecimal(value)), options);
}

function stripSign(value: Decimal): Decimal {
  return value.startsWith('-') ? (value.slice(1) as Decimal) : value;
}
