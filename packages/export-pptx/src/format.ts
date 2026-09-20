/**
 * Display formatting for exact model decimals.
 *
 * Formatting is presentation only: every string derives from the model's
 * canonical decimal without rounding beyond the stated display scale, and
 * numerals stay Latin in both locales (matching the established deck
 * composition). Charts and notes always carry the exact values.
 */
import { isDecimal } from '@rowfolio/contracts';
import { exportUnitLabel } from '@rowfolio/export-model';
import type { Unit } from '@rowfolio/contracts';

const GROUP = new Intl.NumberFormat('en-US', { useGrouping: true });

function signOf(value: string): string {
  return value.startsWith('-') ? '-' : '';
}

function digitsOf(value: string): string {
  return value.startsWith('-') ? value.slice(1) : value;
}

/** Grouped full precision: `6000000.00` → `6,000,000.00`. */
export function formatFull(value: string): string {
  if (!isDecimal(value)) return value;
  const sign = signOf(value);
  const [int, frac] = digitsOf(value).split('.');
  const grouped = GROUP.format(BigInt(int === '' ? '0' : (int as string)));
  return frac === undefined ? `${sign}${grouped}` : `${sign}${grouped}.${frac}`;
}

/** Compact millions/thousands: `6000000.00` → `6.00m`. Scale is display only. */
export function formatCompact(value: string): string {
  if (!isDecimal(value)) return value;
  const sign = signOf(value);
  const [int] = digitsOf(value).split('.');
  const magnitude = (int as string).replace(/^0+/, '').length;
  if (magnitude > 6) {
    return `${sign}${shiftDecimal(digitsOf(value), -6)}m`;
  }
  if (magnitude > 3) {
    // Thousands trim (never round up) to a readable precision: `881k`,
    // `10.8k`. Truncation is intentional for display only; the model
    // value behind the label is untouched.
    const shifted = shiftDecimal(digitsOf(value), -3);
    const [whole, frac = ''] = shifted.split('.');
    const trimmed = frac.replace(/0+$/, '');
    return `${sign}${whole}${trimmed === '' ? '' : `.${trimmed}`}k`;
  }
  return formatFull(value);
}

function shiftDecimal(value: string, places: number): string {
  const [int, frac = ''] = value.split('.');
  const digits = `${int}${frac}`.replace(/^0+/, '') || '0';
  const point = (int as string).length + places;
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${digits}${'0'.repeat(point - digits.length)}.00`;
  return `${digits.slice(0, point)}.${(digits.slice(point) + '00').slice(0, 2)}`;
}

/** Grouped integers: `10800` → `10,800`. */
export function formatInteger(value: string): string {
  if (!isDecimal(value)) return value;
  const [int] = digitsOf(value).split('.');
  return `${signOf(value)}${GROUP.format(BigInt((int as string) === '' ? '0' : (int as string)))}`;
}

/** Stored fractions display as percentages: `-0.119` → `-11.9%`. */
export function formatPercent(value: string): string {
  if (!isDecimal(value)) return value;
  const sign = signOf(value);
  const [int, frac = ''] = digitsOf(value).split('.');
  const digits = `${int}${frac}`;
  const point = (int as string).length + 2;
  const shifted = point <= 0
    ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length
      ? `${digits}${'0'.repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [whole, rest = ''] = shifted.split('.');
  const tenths = (rest + '0').slice(0, 1);
  const hundredths = (rest + '00').slice(1, 2);
  const rounded = Number(tenths) + (Number(hundredths) >= 5 ? 1 : 0);
  const carry = rounded === 10 ? 1 : 0;
  const finalWhole = String(Number(whole) + carry);
  const finalTenths = rounded === 10 ? '0' : String(rounded);
  return `${sign}${GROUP.format(BigInt(finalWhole))}.${finalTenths}%`;
}

/**
 * Percentage-point values are stored pre-multiplied (`-6` means −6pp),
 * so display groups the value and appends the unit without scaling.
 */
export function formatPp(value: string): string {
  if (!isDecimal(value)) return value;
  return `${formatFull(value)}pp`;
}

/** Unit-aware display for a metric value. Null stays explicitly unavailable. */
export function formatMetricValue(value: string | null, unit: Unit): string {
  if (value === null) return '—';
  const unitLabel = exportUnitLabel(unit);
  switch (unit.kind) {
    case 'currency':
      return `${unitLabel} ${formatFull(value)}`.trim();
    case 'ratio':
      return formatPercent(value);
    case 'percentage-point':
      return formatPp(value);
    case 'count':
    case 'minutes':
    case 'score':
      return `${formatInteger(value)} ${unitLabel}`.trim();
    default:
      return formatFull(value);
  }
}
