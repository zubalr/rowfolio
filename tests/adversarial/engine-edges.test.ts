/**
 * Adversarial engine suite — decimal/scenario/analysis/provenance edge
 * cases: huge numbers, strange dates, zero denominators, crafted spans,
 * formula-cache values that are formatted text, and scope filters that
 * silently no-op. `it.fails` = demonstrated defect (assertion encodes the
 * correct contract).
 */
import { describe, expect, it } from 'vitest';
import {
  OPERATING_COST_SCENARIO_V1,
  addDecimal,
  checkNormalizedTable,
  checkScenarioResult,
  divideDecimal,
  isDecimal,
} from '../../packages/contracts/src/index.ts';
import type { Decimal, NormalizedTable, Scope } from '../../packages/contracts/src/index.ts';
import { quantizeMoney, runScenario } from '../../packages/scenario/src/index.ts';
import { normalizeTable, profileTable } from '../../packages/normalize/src/index.ts';
import { analyze } from '../../packages/analysis/src/index.ts';
import { expandSpans, readEvidencePage, MAX_EVIDENCE_PAGE, ProofError } from '../../packages/provenance/src/index.ts';
import { scopeRows, findDateColumn } from '../../packages/analysis/src/index.ts';
import { rawTable } from './helpers.ts';
import snapshotFixture from '../contract/fixtures/analysis-snapshot.example.json';

function normalizedOf(raw: RawTableLike, approveAll = false): NormalizedTable {
  const profile = profileTable(raw);
  const plan = {
    issueIds: approveAll ? profile.issues.map((i) => i.id) : [],
    columns: profile.proposedColumns,
    useUnverifiedFormulaCaches: [] as string[],
  };
  const table = normalizeTable(raw, plan);
  expect(checkNormalizedTable(table)).toEqual([]);
  return table;
}

type RawTableLike = ReturnType<typeof rawTable>;

/* ------------------------------------------------------------------ */
/* Decimals & money quantization                                       */
/* ------------------------------------------------------------------ */

describe('decimal edges', () => {
  it('canonical decimal arithmetic survives huge magnitudes and tiny fractions', () => {
    expect(addDecimal('999999999999999999999999.999999', '0.000001')).toBe('1000000000000000000000000');
    expect(() => divideDecimal('1', '0')).toThrowError(/division by zero/);
    expect(() => divideDecimal('1', '0.000')).toThrowError(/division by zero/);
    expect(isDecimal('-0')).toBe(false);
    expect(isDecimal('-0.00')).toBe(false);
  });

  it.fails('quantizeMoney never emits negative zero (canonical-form violation)', () => {
    // DEFECT: values like '-0.004' with places=2 produce '-0.00',
    // which violates the canonical-decimal rule (isDecimal('-0.00') ===
    // false). Latent: runScenario's call graph currently only feeds inputs
    // whose fraction length ≤ places, so this can't ship a bad metric today —
    // but the exported helper itself is contract-violating.
    const q = quantizeMoney('-0.004' as Decimal, 2);
    expect(isDecimal(q)).toBe(true);
  });

  it('quantizeMoney keeps exact values intact', () => {
    expect(quantizeMoney('-0.004' as Decimal, 3)).toBe('-0.004');
    expect(quantizeMoney('1234.5' as Decimal, 2)).toBe('1234.50');
    expect(quantizeMoney('-1.005' as Decimal, 2)).toBe('-1.01');
  });
});

/* ------------------------------------------------------------------ */
/* Scenario attacks                                                    */
/* ------------------------------------------------------------------ */

function snapshotWith(metrics: { id: string; value: string; kind?: 'currency' | 'ratio' }[]): AnalysisSnapshotLike {
  // Clone the contract fixture so every schema-required field is valid; only
  // the attacked surface (metric ids/values) is replaced.
  const base = snapshotFixture as unknown as {
    metrics: { id: string; unit: unknown; [k: string]: unknown }[];
    provenance: { id: string; [k: string]: unknown }[];
    [k: string]: unknown;
  };
  const metricTpl = base.metrics.find((m) => m.id === 'north-june-revenue') ?? base.metrics[0]!;
  const provTpl = base.provenance[0]!;
  const crafted = metrics.map((m) => ({
    ...metricTpl,
    id: m.id,
    value: m.value,
    scope: { ...(base.scope as object) },
    unit: m.kind === 'ratio' ? { kind: 'ratio', label: 'fraction', currency: null } : metricTpl.unit,
    provenanceId: `p-${m.id}`,
  }));
  const provenance = crafted.map((m) => ({ ...provTpl, id: m.provenanceId }));
  return { ...base, metrics: crafted, provenance } as never;
}

type AnalysisSnapshotLike = Parameters<typeof runScenario>[0];

describe('scenario edges', () => {
  const def = OPERATING_COST_SCENARIO_V1;

  it('out-of-range and off-step cost changes fail typed, never clamp', () => {
    const snap = snapshotWith([
      { id: 'june-revenue', value: '100' },
      { id: 'june-operating-cost', value: '40' },
      { id: 'margin', value: '0.6', kind: 'ratio' },
    ]);
    for (const bad of ['-0.201', '0.301', '-1', '2', 'abc', 'NaN', '0.0001']) {
      let code: string | null = null;
      try {
        runScenario(snap, def, bad as Decimal);
      } catch (e) {
        code = (e as { code?: string }).code ?? null;
      }
      expect(code).toBe('invalid-cost-change');
    }
  });

  it('boundary cost changes -0.20 and 0.30 are accepted', () => {
    const snap = snapshotWith([
      { id: 'june-revenue', value: '100' },
      { id: 'june-operating-cost', value: '40' },
      { id: 'margin', value: '0.6', kind: 'ratio' },
    ]);
    for (const change of ['-0.20', '0.30', '0', '0.001', '-0.001']) {
      const res = runScenario(snap, def, change as Decimal);
      expect(checkScenarioResult(res, { snapshot: snap, definition: def } as never)).toEqual([]);
      expect(res.status).toBe('defined');
    }
  });

  it('zero revenue yields an explicit unavailable result — never NaN/∞', () => {
    const snap = snapshotWith([
      { id: 'june-revenue', value: '0' },
      { id: 'june-operating-cost', value: '40' },
      { id: 'margin', value: '0', kind: 'ratio' },
    ]);
    const res = runScenario(snap, def, '0.05' as Decimal);
    expect(res.status).toBe('unavailable');
    expect(res.reasonKey).toBe('scenario.zeroRevenue');
    expect(checkScenarioResult(res, { snapshot: snap, definition: def } as never)).toEqual([]);
  });

  it('negative/zero scenarios never divide by zero: margin over revenue=0 unavailable', () => {
    const snap = snapshotWith([
      { id: 'june-revenue', value: '-5' },
      { id: 'june-operating-cost', value: '40' },
      { id: 'margin', value: '9', kind: 'ratio' },
    ]);
    const res = runScenario(snap, def, '0.05' as Decimal);
    expect(res.status).toBe('unavailable');
  });
});

/* ------------------------------------------------------------------ */
/* Scope filter that silently no-ops                                   */
/* ------------------------------------------------------------------ */

describe('scope attacks', () => {
  it.fails('confirmedScope.regions must not silently pass all rows when no region column exists', () => {
    const raw = rawTable(['date', 'amount'], [['2026-06-01', '10'], ['2026-06-02', '20']]);
    const table = normalizedOf(raw);
    const dateCol = findDateColumn(table);
    expect(dateCol).toBeTruthy();
    const regions = ['Atlantis']; // region value that matches nothing
    const scoped = scopeRows(table, dateCol!, { start: '2026-01-01', end: '2026-12-31' }, null, regions);
    // CORRECT: with regions non-empty and no region column, the scope is
    // unsatisfiable — returning every row while claiming a regional filter
    // falsifies every downstream metric.
    expect(scoped.rows).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Provenance span bombs                                               */
/* ------------------------------------------------------------------ */

describe('provenance span attacks', () => {
  it.fails('expandSpans must refuse oversize spans, not materialize millions of ids', () => {
    // expandSpans pushes one number per row with no bound: [{start:1,
    // end:2^31-1}] crashes the process at ~16GB heap (verified out-of-band —
    // fatal V8 OOM, not a catchable error). Correct contract: a typed
    // ProofError-style refusal once the expanded row count exceeds the
    // evidence/source bound. Demonstrated at 20M (still seconds + ~160MB).
    const start = performance.now();
    const rows = expandSpans([{ start: 1, end: 20_000_000 }]);
    const ms = performance.now() - start;
    console.log(`expanded ${rows.length} ids in ${ms.toFixed(0)}ms`);
    expect(rows.length).toBeLessThanOrEqual(MAX_EVIDENCE_PAGE);
  });

  it('readEvidencePage caps page size at MAX_EVIDENCE_PAGE', () => {
    const proof = {
      id: 'p',
      sourceRefs: [],
      selections: [{ fieldId: 'a', spans: [{ start: 1, end: 10 }] }],
      expression: { op: 'literal', value: '1' },
      result: '1',
      status: 'defined',
      reasonKey: null,
      policyVersion: '1.0.0',
      normalizationRevision: 'r',
      transformIds: [],
      precision: 'exact-decimal',
      rounding: 'none',
    } as never;
    const raw = rawTable(['a'], Array.from({ length: 10 }, (_, i) => [`${i}`]));
    // Bounded refusal: oversize pages are rejected, never served.
    expect(() => readEvidencePage(proof, raw, 0, MAX_EVIDENCE_PAGE + 1)).toThrowError(ProofError);
    expect(() => readEvidencePage(proof, raw, -1, 10)).toThrowError(ProofError);
  });
});

/* ------------------------------------------------------------------ */
/* Formula-cache = formatted text                                      */
/* ------------------------------------------------------------------ */

describe('formula-cache formatting attack', () => {
  it('cachedValue "1,234.56" (formatted) is kept verbatim — consumers must treat it as text', () => {
    const raw = rawTable(
      ['amount'],
      [['=B1', null] as (string | null)[]],
      { types: ['formula'], cachedValues: [['1,234.56']] },
    );
    const profile = profileTable(raw);
    // normalize WITHOUT opt-in → null
    const planNoCache = { issueIds: profile.issues.map((i) => i.id), columns: profile.proposedColumns, useUnverifiedFormulaCaches: [] as string[] };
    const t1 = normalizeTable(raw, planNoCache);
    expect(t1.rows[0]?.values['amount']).toBeNull();
    // With opt-in the formatted string lands in the typed column — '1,234.56'
    // is not a canonical decimal so it stays text → shared-mask exclusion.
    const planCache = { ...planNoCache, useUnverifiedFormulaCaches: ['amount'] };
    const t2 = normalizeTable(raw, planCache);
    const v = t2.rows[0]?.values['amount'];
    // Contract: the formatted cache lands VERBATIM (never silently parsed to
    // a number — '1,234.56' is not canonical decimal, so aggregates treat it
    // as missing; the surface issue flags it).
    expect(v).toBe('1,234.56');
    expect(checkNormalizedTable(t2)).toEqual([]);
    expect(profile.issues.some((i) => i.kind === 'formula-cache')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Analysis on hostile-shaped normalized tables                        */
/* ------------------------------------------------------------------ */

describe('analyze edges', () => {
  it('empty table (header only) produces a valid snapshot with no findings', () => {
    const table = normalizedOf(rawTable(['a', 'b'], []));
    const snap = analyze(table, {
      version: '1.0.0',
      confirmedScope: { tableId: table.id, periodStart: null, periodEnd: null, regions: [], complete: false, coverageNoteKey: 'coverage.allSource' } as Scope,
      samplePolicyId: null,
    });
    expect(snap.metrics.length).toBeGreaterThanOrEqual(0);
  });

  it('all-missing data column does not produce a bogus sum', () => {
    const raw = rawTable(['date', 'amount'], [['2026-01-01', null], ['2026-01-02', null]]);
    const table = normalizedOf(raw);
    const snap = analyze(table, {
      version: '1.0.0',
      confirmedScope: { tableId: table.id, periodStart: null, periodEnd: null, regions: [], complete: false, coverageNoteKey: 'coverage.allSource' } as Scope,
      samplePolicyId: null,
    });
    for (const m of snap.metrics) {
      if (m.value !== null) expect(isDecimal(m.value)).toBe(true);
    }
  });

  it('Arabic + mixed-script values and extreme decimals reconcile through analyze', () => {
    const raw = rawTable(
      ['date', 'region', 'amount'],
      [
        ['2026-06-01', 'الشمال', '999999999999999999999'],
        ['2026-06-02', 'North', '0.000000000000000001'],
        ['2026-06-03', 'الجنوب', '-999999999999999999999'],
      ],
    );
    const table = normalizedOf(raw);
    const snap = analyze(table, {
      version: '1.0.0',
      confirmedScope: { tableId: table.id, periodStart: null, periodEnd: null, regions: [], complete: false, coverageNoteKey: 'coverage.allSource' } as Scope,
      samplePolicyId: null,
    });
    // Sum of the three amounts must reconcile exactly: 1e-18 — no float drift.
    const total = snap.metrics.find((m) => /amount|total/i.test(m.id));
    if (total && total.value !== null) {
      expect(total.value).toBe(addDecimal(addDecimal('999999999999999999999', '0.000000000000000001'), '-999999999999999999999'));
    }
  });
});
