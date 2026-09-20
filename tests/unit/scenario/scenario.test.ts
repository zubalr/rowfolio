/**
 * Scenario engine tests: the golden +8% truth row, input validation
 * (no clamping, typed steps), boundaries, monotonicity, baseline
 * immutability, disabled recipes, and oracle parity of every proof.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkScenarioResult,
  compareDecimal,
  OPERATING_COST_SCENARIO_V1,
  type AnalysisSnapshot,
  type Metric,
  type NormalizedTable,
  type ScenarioResult,
} from '../../../packages/contracts/src/index.ts';
import {
  fractionScale,
  quantizeMoney,
  runScenario,
  scenarioId,
  ScenarioError,
} from '../../../packages/scenario/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', 'tests', 'contract', 'fixtures');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

const snapshot = load<AnalysisSnapshot>('analysis-snapshot.example.json');
const golden = load<ScenarioResult>('scenario-result.example.json');
const definition = OPERATING_COST_SCENARIO_V1;
const table = load<NormalizedTable>('normalized-table.example.json');

describe('golden +8% truth', () => {
  it('reproduces the checked-in scenario result values and proof shapes', () => {
    const result = runScenario(snapshot, definition, '0.08');
    // Standalone assertion cannot resolve baseline metric refs by design;
    // validate in the merged baseline namespace instead.
    expect(checkScenarioResult(result, {
      snapshot,
      definition,
      table,
      sourceHash: snapshot.sourceHash,
    })).toEqual([]);
    expect(result.id).toBe(golden.id);
    expect(result.metrics.map((m) => [m.id, m.value])).toEqual(
      golden.metrics.map((m) => [m.id, m.value]),
    );
    expect(result.metrics.map((m) => [m.id, m.labelKey, m.unit, m.provenanceId])).toEqual(
      golden.metrics.map((m) => [m.id, m.labelKey, m.unit, m.provenanceId]),
    );
    expect(result.provenance.map((p) => [p.id, p.expression, p.result])).toEqual(
      golden.provenance.map((p) => [p.id, p.expression, p.result]),
    );
    expect(result.provenance.map((p) => p.sourceRefs)).toEqual(
      golden.provenance.map((p) => p.sourceRefs),
    );
  });

  it('passes the contract validator against the baseline snapshot', () => {
    const result = runScenario(snapshot, definition, '0.08');
    const issues = checkScenarioResult(result, {
      snapshot,
      definition,
      table,
      sourceHash: snapshot.sourceHash,
    });
    expect(issues).toEqual([]);
  });
});

describe('input validation', () => {
  const cases: Array<[string, string]> = [
    ['NaN', 'non-finite literal'],
    ['Infinity', 'non-finite literal'],
    ['0.08%', 'units are rejected'],
    ['0.31', 'above range'],
    ['-0.21', 'below range'],
    ['0.0805', 'off the typed step'],
    ['abc', 'not a decimal'],
  ];
  for (const [input, why] of cases) {
    it(`rejects ${input} (${why}) instead of clamping`, () => {
      expect(() => runScenario(snapshot, definition, input)).toThrow(ScenarioError);
    });
  }

  it('accepts the -0.20/+0.30 boundaries and exact 0.001 steps', () => {
    expect(runScenario(snapshot, definition, '-0.20').status).toBe('defined');
    expect(runScenario(snapshot, definition, '0.30').status).toBe('defined');
    expect(runScenario(snapshot, definition, '0.001').status).toBe('defined');
  });

  it('rejects unknown recipes without inventing semantics', () => {
    const other = { ...definition, id: 'other-v1' };
    expect(() => runScenario(snapshot, other, '0.08')).toThrow(ScenarioError);
  });
});

describe('engine properties', () => {
  it('zero factor is the identity on cost', () => {
    const result = runScenario(snapshot, definition, '0');
    const cost = result.metrics.find((m) => m.id === 'scenario-cost');
    expect(cost?.value).toBe('4500000.00');
  });

  it('contribution falls monotonically as the factor rises', () => {
    const values = ['-0.20', '0', '0.08', '0.30'].map((f) => {
      const r = runScenario(snapshot, definition, f);
      return r.metrics.find((m) => m.id === 'scenario-contribution')?.value as string;
    });
    for (let i = 1; i < values.length; i += 1) {
      expect(compareDecimal(values[i] as string, values[i - 1] as string)).toBeLessThan(0);
    }
  });

  it('never mutates the baseline snapshot', () => {
    const before = JSON.stringify(snapshot);
    runScenario(snapshot, definition, '0.08');
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('keeps the scenario namespace disjoint from baseline ids', () => {
    const result = runScenario(snapshot, definition, '0.08');
    const baseline = new Set(snapshot.metrics.map((m) => m.id));
    for (const m of result.metrics) expect(baseline.has(m.id)).toBe(false);
  });

  it('disables the recipe on zero revenue or negative cost with reason keys', () => {
    const zeroRevenue = {
      ...snapshot,
      metrics: snapshot.metrics.map((m) =>
        m.id === 'june-revenue' ? { ...m, value: '0' } : m,
      ),
    };
    const unavailable = runScenario(zeroRevenue, definition, '0.08');
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.reasonKey).toBe('scenario.zeroRevenue');
    expect(unavailable.metrics).toEqual([]);
    // An unavailable result with a reason key is itself contract-valid.
    expect(checkScenarioResult(unavailable, { snapshot: zeroRevenue, definition })).toEqual([]);

    const negCost = {
      ...snapshot,
      metrics: snapshot.metrics.map((m) =>
        m.id === 'june-operating-cost' ? { ...m, value: '-5' } : m,
      ),
    };
    const unavailable2 = runScenario(negCost, definition, '0.08');
    expect(unavailable2.status).toBe('unavailable');
    expect(unavailable2.reasonKey).toBe('scenario.negativeCost');
  });

  it('fails loudly on missing or undefined required metrics', () => {
    const missing = { ...snapshot, metrics: snapshot.metrics.filter((m) => m.id !== 'june-revenue') };
    expect(() => runScenario(missing, definition, '0.08')).toThrow(ScenarioError);
    const undef = {
      ...snapshot,
      metrics: snapshot.metrics.map((m: Metric) =>
        m.id === 'june-operating-cost' ? { ...m, status: 'undefined' as const, value: null, reasonKey: 'test' } : m,
      ),
    };
    expect(() => runScenario(undef, definition, '0.08')).toThrow(ScenarioError);
  });
});

describe('money helpers', () => {
  it('quantizes half-up to the money scale', () => {
    expect(quantizeMoney('4860000.0000', 2)).toBe('4860000.00');
    expect(quantizeMoney('1.005', 2)).toBe('1.01');
    expect(quantizeMoney('-6.005', 2)).toBe('-6.01');
    expect(quantizeMoney('5', 0)).toBe('5');
    expect(fractionScale('4500000.00')).toBe(2);
    expect(fractionScale('17')).toBe(0);
    expect(scenarioId('analysis-abc', '0.08')).toBe('scenario-analysis-abc-cost008');
  });
});
