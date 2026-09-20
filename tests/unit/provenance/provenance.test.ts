/**
 * Provenance unit tests: span compression, proof recomputation parity with
 * the golden snapshot, cycle/unknown-id rejection, and pagination bounds.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  AnalysisSnapshot,
  Metric,
  NormalizedTable,
  Provenance,
  RowSelection,
} from '../../../packages/contracts/src/index.ts';
import { compareDecimal } from '../../../packages/contracts/src/index.ts';
import {
  bidiIsolate,
  canonicalizeSpans,
  checkSelection,
  evaluateProof,
  evidenceRow,
  expandSpans,
  MAX_EXPANDED_ROWS,
  ProofError,
  readEvidencePage,
  requireSelection,
  spanRowCount,
  SpanError,
  validateSpans,
} from '../../../packages/provenance/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', 'tests', 'contract', 'fixtures');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

const table = load<NormalizedTable>('normalized-table.example.json');
const snapshot = load<AnalysisSnapshot>('analysis-snapshot.example.json');

describe('span compression', () => {
  it('never merges gaps but collapses contiguous runs', () => {
    expect(canonicalizeSpans([9, 2, 4])).toEqual([
      { start: 2, end: 2 },
      { start: 4, end: 4 },
      { start: 9, end: 9 },
    ]);
    expect(canonicalizeSpans([3, 2, 4, 2])).toEqual([{ start: 2, end: 4 }]);
    expect(spanRowCount(canonicalizeSpans([9, 2, 4]))).toBe(3);
    expect(expandSpans([{ start: 1802, end: 1901 }])).toHaveLength(100);
  });

  it('rejects inverted, overlapping, adjacent and miscounted spans', () => {
    expect(validateSpans([{ start: 5, end: 3 }], 0).valid).toBe(false);
    expect(validateSpans([{ start: 1, end: 5 }, { start: 4, end: 8 }], 9).valid).toBe(false);
    expect(validateSpans([{ start: 1, end: 2 }, { start: 3, end: 4 }], 4).valid).toBe(false);
    expect(validateSpans([{ start: 1, end: 4 }], 5).valid).toBe(false);
    expect(validateSpans([{ start: 1, end: 4 }], 4).valid).toBe(true);
  });

  it('refuses abusive expansion before allocating anything', () => {
    // The reported OOM shape: bounds are checked mathematically, so the
    // refusal needs only a tiny input, never a heap-sized reproduction.
    expect(() => expandSpans([{ start: 1, end: 2147483647 }])).toThrowError(SpanError);
    expect(() => expandSpans([{ start: 1, end: MAX_EXPANDED_ROWS + 1 }])).toThrowError(SpanError);
    expect(expandSpans([{ start: 1, end: MAX_EXPANDED_ROWS }])).toHaveLength(MAX_EXPANDED_ROWS);
  });

  it('rejects malformed, reversed, non-finite and unsafe-integer spans', () => {
    expect(() => expandSpans([{ start: 5, end: 3 }])).toThrowError(SpanError);
    expect(() => expandSpans([{ start: 0, end: 4 }])).toThrowError(SpanError);
    expect(() => expandSpans([{ start: 1.5, end: 4 }])).toThrowError(SpanError);
    expect(() => expandSpans([{ start: NaN, end: 4 }])).toThrowError(SpanError);
    expect(() => expandSpans([{ start: 1, end: Infinity }])).toThrowError(SpanError);
    expect(() => expandSpans([{ start: 1, end: Number.MAX_SAFE_INTEGER }])).toThrowError(SpanError);
    expect(() => expandSpans([{ start: 1, end: 4 }], 3)).toThrowError(SpanError);
    expect(() => expandSpans([{ start: 1, end: 4 }], -1)).toThrowError(SpanError);
    // Valid callers are unaffected, including custom tighter bounds.
    expect(expandSpans([{ start: 2, end: 4 }])).toEqual([2, 3, 4]);
    expect(expandSpans([{ start: 2, end: 4 }], 3)).toEqual([2, 3, 4]);
  });
});

describe('proof evaluation', () => {
  it('recomputes every golden proof to its stated result', () => {
    for (const proof of snapshot.provenance) {
      const outcome = evaluateProof(proof, table, snapshot.metrics, snapshot.provenance);
      expect(outcome.reasonKey, proof.id).toBeNull();
      // Numeric equality: `881000` and `881000.00` are the same value;
      // display scale is preserved by producers, not the evaluator.
      expect(proof.result, proof.id).not.toBeNull();
      expect(compareDecimal(outcome.value as string, proof.result as string), proof.id).toBe(0);
    }
  });

  it('reports missing sibling proofs instead of trusting stated values', () => {
    const gap = snapshot.provenance.find((p) => p.id === 'north-target-gap-proof') as Provenance;
    const outcome = evaluateProof(gap, table, snapshot.metrics);
    expect(outcome.value).toBeNull();
    expect(outcome.reasonKey).toBe('proof.missing');
  });

  it('returns typed undefined instead of throwing for unknown selections', () => {
    const broken: Provenance = {
      ...snapshot.provenance[0] as Provenance,
      id: 'broken-proof',
      expression: { op: 'sum', selectionId: 'nope', fieldId: 'revenue' },
      result: null,
      status: 'undefined',
    };
    const outcome = evaluateProof(broken, table, snapshot.metrics);
    expect(outcome.value).toBeNull();
    expect(outcome.reasonKey).toBe('selection.missing');
  });

  it('rejects proof metric cycles without hanging', () => {
    const mk = (id: string): Metric => ({
      ...(snapshot.metrics[0] as Metric),
      id,
      value: '1',
      status: 'defined',
      reasonKey: null,
      provenanceId: `${id}-proof`,
    });
    const proofA: Provenance = {
      ...(snapshot.provenance[0] as Provenance),
      id: 'cycle-a-proof',
      selections: [],
      expression: { op: 'metric', metricId: 'cycle-b' },
      result: null,
      status: 'undefined',
    };
    const proofB: Provenance = {
      ...(snapshot.provenance[0] as Provenance),
      id: 'cycle-b-proof',
      selections: [],
      expression: { op: 'metric', metricId: 'cycle-a' },
      result: null,
      status: 'undefined',
    };
    const cyclic = evaluateProof(
      { ...proofA, expression: { op: 'metric', metricId: 'cycle-a' } },
      table,
      [mk('cycle-a'), mk('cycle-b'), ...snapshot.metrics],
    );
    void proofB;
    expect(cyclic.value).toBeNull();
    expect(cyclic.reasonKey).toContain('cycle');
  });

  it('reports divide-by-zero as undefined, never Infinity', () => {
    const proof: Provenance = {
      ...(snapshot.provenance[0] as Provenance),
      id: 'div0-proof',
      selections: [],
      expression: {
        op: 'divide',
        left: { op: 'literal', value: '1' },
        right: { op: 'literal', value: '0' },
      },
      result: null,
      status: 'undefined',
    };
    const outcome = evaluateProof(proof, table, snapshot.metrics);
    expect(outcome).toEqual({ value: null, reasonKey: 'divideByZero' });
  });
});

describe('selections and evidence', () => {
  const selection: RowSelection = (snapshot.provenance.find((p) => p.id === 'north-june-revenue-proof') as Provenance).selections[0] as RowSelection;

  it('validates the golden North June selection against the table', () => {
    const check = checkSelection(selection, table);
    expect(check.problems).toEqual([]);
    expect(check.valid).toBe(true);
    expect(check.contributingRows).toHaveLength(100);
  });

  it('flags selections that claim excluded rows', () => {
    const bad: RowSelection = { ...selection, id: 'bad', spans: [{ start: 2402, end: 2402 }], rowCount: 1 };
    const check = checkSelection(bad, table);
    expect(check.valid).toBe(false);
    expect(check.problems.join(' ')).toContain('absent source rows');
  });

  it('pages contributing rows with stable next offsets', () => {
    const first = readEvidencePage(table, selection, 0, 30);
    expect(first.rows).toHaveLength(30);
    expect(first.total).toBe(100);
    expect(first.nextOffset).toBe(30);
    const last = readEvidencePage(table, selection, 90, 30);
    expect(last.rows).toHaveLength(10);
    expect(last.nextOffset).toBeNull();
    const beyond = readEvidencePage(table, selection, 500, 30);
    expect(beyond.rows).toHaveLength(0);
    expect(beyond.total).toBe(100);
  });

  it('rejects invalid pages with typed errors', () => {
    expect(() => readEvidencePage(table, selection, -1, 10)).toThrow(ProofError);
    expect(() => readEvidencePage(table, selection, 0, 501)).toThrow(ProofError);
    expect(() => requireSelection(snapshot.provenance, 'missing')).toThrow(ProofError);
  });

  it('links evidence rows to their ledger transforms', () => {
    const ev = evidenceRow(table, 19);
    expect(ev?.transforms.some((t) => t.kind === 'category')).toBe(true);
    expect(ev?.originalValues['region']).toBe('NORTH');
    expect(evidenceRow(table, 999999)).toBeNull();
  });

  it('isolates identifiers for mixed-direction display', () => {
    expect(bidiIsolate('OP-00001')).toBe('⁦OP-00001⁩');
  });
});
