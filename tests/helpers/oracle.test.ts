/**
 * Metric-oracle self-tests: the oracle must pass a verbatim copy of its
 * fields and must fail loudly on planted wrong metrics — the harness
 * proves detection, not just happy-path agreement.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isCanonicalDecimal, normalizeDecimalString } from '../../packages/contracts/src/index.ts';
import { assertMetric, MetricMismatch, metricEqual, normalizeDecimal } from '../../tooling/test/metrics.ts';
import {
  arbCanonicalDecimal,
  arbLooseDecimal,
  assertOracleFields,
  assertProperty,
  expectMetric,
  hostileFixture,
  loadJson,
  loadOracle,
  normalizeAgree,
  oracleDiffs,
  oracleFields,
} from './index.ts';

const oracle = loadOracle();

describe('metric assertions', () => {
  it('canonical decimals round-trip identically', () => {
    for (const [a, e] of [
      ['881000', '881000'],
      ['881000.00', '0881000.00'],
      ['+6000000.00', '6000000.00'],
      ['-0.25', '-0.25'],
      ['0', '-0'],
    ] as const) {
      expectMetric(`${a} vs ${e}`, a, e);
      expect(metricEqual(a, e)).toBe(true);
    }
  });

  it('deliberately wrong metric fails (metric.mismatch, MetricMismatch)', () => {
    const fields = oracleFields(oracle);
    expect(() => expectMetric('northJuneRevenue', '882000', fields['northJuneRevenue']!)).toThrow(/metric\.mismatch/);
    expect(() => assertMetric('882000', '881000', 'northJuneRevenue')).toThrow(MetricMismatch);
    expect(metricEqual('882000', '881000')).toBe(false);
  });

  it('scale drift is a strict-metric defect but canonically equal', () => {
    expect(metricEqual('0.25', '0.2500')).toBe(false);
    expect(normalizeDecimalString('0.25')).toBe(normalizeDecimalString('0.2500'));
  });
});

describe('normalizer agreement (contract vs independent)', () => {
  it('canonical decimals: identical results', () => {
    assertProperty('canonical decimals agree', fc.property(arbCanonicalDecimal(), (s) => {
      return normalizeDecimalString(s) === s && normalizeAgree(s) === normalizeDecimalString(s) && isCanonicalDecimal(s);
    }), { numRuns: 500 });
  });

  it('loose decimals: whenever the contract accepts, the independent value agrees', () => {
    assertProperty('loose decimals agree', fc.property(arbLooseDecimal, (s) => {
      const independent = normalizeDecimal(s);
      let contract: string | null;
      try {
        contract = normalizeDecimalString(s);
      } catch {
        contract = null; // contract is stricter on surface form — allowed
      }
      // contract strictness on surface form is a superset constraint:
      // when it rejects, the independent may accept (canonicalize) or
      // also reject — either is a valid front-end choice.
      if (contract === null) return true;
      return independent !== null && normalizeDecimalString(independent) === contract;
    }), { numRuns: 500 });
  });

  it('rejects non-decimals on both oracles', () => {
    for (const bad of ['abc', '1e5', '', ' 12 ', '1,000.00', 'Infinity', 'NaN', '0x10']) {
      expect(normalizeDecimal(bad), bad).toBeNull();
      expect(() => normalizeDecimalString(bad), bad).toThrow();
    }
  });
});

describe('oracle fixture files', () => {
  const FIELDS = ['northJuneRevenue', 'northJuneTarget', 'juneRevenue', 'juneCost', 'baseMargin', 'scenarioMargin', 'northMayDowntime', 'northJuneDowntime'];

  it('oracle exposes the expected decimal fields', () => {
    const names = Object.keys(oracleFields(oracle));
    for (const f of FIELDS) expect(names).toContain(f);
  });

  it('oracle-consistent analysis reconciles with the oracle', () => {
    const claims = loadJson<{ metrics: Record<string, unknown> }>(hostileFixture('analysis/oracle-consistent.json'));
    expect(oracleDiffs(claims.metrics, oracle, FIELDS)).toEqual([]);
    expect(() => assertOracleFields(claims.metrics, oracle, FIELDS)).not.toThrow();
  });

  it('planted-wrong-metric analysis fails on exactly the mutated fields', () => {
    const claims = loadJson<{ metrics: Record<string, unknown> }>(hostileFixture('analysis/planted-wrong-metric.json'));
    const diffs = oracleDiffs(claims.metrics, oracle, FIELDS);
    expect(new Set(diffs.map((d) => d.field))).toEqual(new Set(['northJuneRevenue', 'northJuneDowntime']));
    expect(() => assertOracleFields(claims.metrics, oracle, FIELDS)).toThrow(/oracle mismatch/);
  });
});
