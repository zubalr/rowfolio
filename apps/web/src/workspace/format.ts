import type { Decimal, Metric, Unit } from '@rowfolio/contracts';
import { toDecimal, type I18n, type NumberFormatOptions } from '@rowfolio/i18n';

/**
 * Format a canonical decimal for display by unit kind. Presentation only.
 * Summary surfaces declare display precision — canonical Decimals can carry
 * arbitrarily long fractions (the i18n formatters preserve them exactly), so
 * every branch bounds fraction digits to the workspace conventions.
 */
export function formatDecimal(i18n: I18n, value: Decimal, unit: Unit): string {
  switch (unit.kind) {
    case 'currency':
      return unit.currency
        ? i18n.formatCurrency(value, unit.currency, { maxFractionDigits: 2 })
        : i18n.formatNumber(value, { maxFractionDigits: 2 });
    case 'ratio':
      return i18n.formatPercent(value, { maxFractionDigits: 1 });
    case 'percentage-point':
      // Deltas are frequently fractional (e.g. -3.75 pp) — cap at 2dp.
      return i18n.formatNumber(value, { maxFractionDigits: 2 });
    case 'count':
    case 'minutes':
    case 'score':
      return i18n.formatInteger(value);
    default:
      return i18n.formatNumber(value, { maxFractionDigits: 2 });
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
  // input must throw, never silently format ('--1' ≠ '1'). Summary surfaces
  // bound display precision; callers may override via options.
  return i18n.formatPercent(stripSign(toDecimal(value)), options ?? { maxFractionDigits: 1 });
}

/**
 * The unit's display badge, or null when the badge carries no information.
 * Engines may emit placeholder labels ("unit", "fraction") — suppress those;
 * a currency badge falls back to its ISO code. Ratios already carry the %
 * sign inside the formatted value, so their badge is redundant noise.
 */
/** Engine-emitted unit labels that carry catalog translations. */
const UNIT_LABEL_KEYS: Record<string, string> = {
  records: 'unit.records',
};

export function metricUnitLabel(unit: Unit, labeler?: (key: string) => string): string | null {
  switch (unit.kind) {
    case 'currency':
      return unit.label === 'unit' || unit.label === '' ? unit.currency : unit.label;
    case 'ratio':
    case 'unknown':
      return null;
    default: {
      const label = unit.label.trim();
      if (label === '' || label === 'unit' || label === 'fraction') return null;
      const key = UNIT_LABEL_KEYS[label];
      if (key !== undefined && labeler !== undefined) return labeler(key);
      return label;
    }
  }
}

function stripSign(value: Decimal): Decimal {
  return value.startsWith('-') ? (value.slice(1) as Decimal) : value;
}
