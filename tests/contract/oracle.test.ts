/**
 * Oracle reconciliation — recompute every stated metric through the
 * deterministic expression evaluator and require numeric equality with the
 * fixture's stated values. This mirrors scripts/validate_contracts.py.
 */
import { describe, expect, it } from 'vitest';
import {
  buildEvalContext,
  compareDecimal,
  evaluateMetric,
  type AnalysisSnapshot,
  type Metric,
  type NormalizedTable,
  type Provenance,
  type ScenarioResult,
} from '../../packages/contracts/src/index.ts';
import { fixture } from './helpers.ts';

const table = fixture<NormalizedTable>('normalized-table.example.json');
const snapshot = fixture<AnalysisSnapshot>('analysis-snapshot.example.json');
const scenario = fixture<ScenarioResult>('scenario-result.example.json');

function evalBundle(metrics: readonly Metric[], proofs: readonly Provenance[]) {
  return buildEvalContext(table, metrics, proofs);
}

describe('oracle reconciliation — baseline snapshot', () => {
  const ctx = evalBundle(snapshot.metrics, snapshot.provenance);

  it('every defined metric recomputes to its stated value (numeric equality)', () => {
    const issues: never[] = [];
    for (const m of snapshot.metrics) {
      if (m.status !== 'defined') continue;
      const outcome = evaluateMetric(m.id, ctx, issues as [], `/${m.id}`);
      expect(outcome.status, `metric ${m.id}`).toBe('defined');
      if (outcome.status === 'defined' && m.value !== null) {
        expect(
          compareDecimal(outcome.value, m.value),
          `metric ${m.id}: recomputed ${outcome.value} ≠ stated ${m.value}`,
        ).toBe(0);
      }
    }
    expect(issues).toEqual([]);
  });

  it('known spot-check values reconcile', () => {
    const byId = new Map(snapshot.metrics.map((m) => [m.id, m] as const));
    // june-revenue and june-operating-cost are the scenario's required metrics.
    expect(byId.has('june-revenue')).toBe(true);
    expect(byId.has('june-operating-cost')).toBe(true);
    const rev = evaluateMetric('june-revenue', ctx, [], '');
    const cost = evaluateMetric('june-operating-cost', ctx, [], '');
    expect(rev.status).toBe('defined');
    expect(cost.status).toBe('defined');
  });
});

describe('oracle reconciliation — scenario', () => {
  const ctx = buildEvalContext(table, [...snapshot.metrics, ...scenario.metrics], [...snapshot.provenance, ...scenario.provenance]);

  it('every defined scenario metric recomputes to its stated value', () => {
    for (const m of scenario.metrics) {
      if (m.status !== 'defined') continue;
      const outcome = evaluateMetric(m.id, ctx, [], `/${m.id}`);
      expect(outcome.status, `scenario metric ${m.id}`).toBe('defined');
      if (outcome.status === 'defined' && m.value !== null) {
        expect(compareDecimal(outcome.value, m.value), `scenario metric ${m.id}`).toBe(0);
      }
    }
  });

  it('scenario namespace: no scenario metric id collides with baseline ids', () => {
    const baseline = new Set(snapshot.metrics.map((m) => m.id));
    for (const m of scenario.metrics) expect(baseline.has(m.id)).toBe(false);
  });
});
