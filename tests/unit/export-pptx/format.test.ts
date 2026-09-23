/**
 * Display formatting regressions: every string derives from exact model
 * decimals, numerals stay Latin, and percentage-point units are never
 * rescaled.
 */
import { describe, expect, it } from 'vitest';
import {
  formatCompact,
  formatFull,
  formatInteger,
  formatMetricValue,
  formatPercent,
  formatPp,
} from '../../../packages/export-pptx/src/format.ts';
import { hasLabel, label, unitLabel } from '../../../packages/export-pptx/src/labels.ts';

describe('display formatting', () => {
  it('groups full values without changing them', () => {
    expect(formatFull('6000000.00')).toBe('6,000,000.00');
    expect(formatFull('-0.119')).toBe('-0.119');
    expect(formatFull('17')).toBe('17');
  });

  it('compacts large magnitudes for headlines only', () => {
    expect(formatCompact('6000000.00')).toBe('6.00m');
    expect(formatCompact('4500000.00')).toBe('4.50m');
    expect(formatCompact('881000')).toBe('881k');
    expect(formatCompact('10800')).toBe('10.8k');
    expect(formatCompact('999')).toBe('999');
  });

  it('renders stored fractions as one-decimal percents', () => {
    expect(formatPercent('-0.119')).toBe('-11.9%');
    expect(formatPercent('0.08')).toBe('8.0%');
    expect(formatPercent('0.25')).toBe('25.0%');
    expect(formatPercent('0')).toBe('0.0%');
  });

  it('never rescales values already in percentage points', () => {
    expect(formatPp('-6')).toBe('-6pp');
    expect(formatPp('2.5')).toBe('2.5pp');
  });

  it('formats integers with grouping', () => {
    expect(formatInteger('10800')).toBe('10,800');
    expect(formatInteger('2417')).toBe('2,417');
  });

  it('formats metric values by unit kind', () => {
    const u = (kind: string, label: string, currency: string | null = null) =>
      ({ kind, label, currency }) as const;
    expect(formatMetricValue('6000000.00', u('currency', 'USD', 'USD'))).toBe('USD 6,000,000.00');
    expect(formatMetricValue('-0.119', u('ratio', 'fraction'))).toBe('-11.9%');
    expect(formatMetricValue('-6', u('percentage-point', 'pp'))).toBe('-6pp');
    expect(formatMetricValue('1565', u('minutes', 'minutes'))).toBe('1,565 minutes');
    expect(formatMetricValue(null, u('currency', 'USD', 'USD'))).toBe('—');
  });

  it('inflects the records unit for the exact count it measures', () => {
    const u = (kind: string, label: string, currency: string | null = null) =>
      ({ kind, label, currency }) as const;
    const en = (key: string, count?: number) => unitLabel('en', key, count);
    const ar = (key: string, count?: number) => unitLabel('ar', key, count);
    expect(formatMetricValue('1', u('count', 'records'), en)).toBe('1 record');
    expect(formatMetricValue('0', u('count', 'records'), en)).toBe('0 records');
    expect(formatMetricValue('17', u('count', 'records'), en)).toBe('17 records');
    expect(formatMetricValue('1', u('count', 'records'), ar, 'arab')).toBe('١ سجل');
    expect(formatMetricValue('5', u('count', 'records'), ar, 'arab')).toBe('٥ سجلات');
    // User-data units and labeler-free calls keep the raw label verbatim.
    expect(formatMetricValue('1', u('minutes', 'minutes'), en)).toBe('1 minutes');
    expect(formatMetricValue('1', u('count', 'records'))).toBe('1 records');
  });
});

describe('deck labels', () => {
  it('resolves human labels in both locales', () => {
    expect(label('en', 'metric.revenue')).toBe('Revenue');
    expect(label('ar', 'metric.revenue')).toBe('الإيرادات');
    expect(label('en', 'finding.north.title')).toContain('orders');
  });

  it('fails visibly on unknown keys and reports coverage', () => {
    expect(() => label('en', 'metric.nope')).toThrowError(/missing deck label/);
    expect(hasLabel('metric.revenue')).toBe(true);
    expect(hasLabel('metric.nope')).toBe(false);
  });
});
