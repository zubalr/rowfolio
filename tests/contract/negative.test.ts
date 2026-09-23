/**
 * Negative fixtures — each mutation must fail for the intended reason.
 * Assertions target the rule name so a failure for the wrong reason still
 * fails the test.
 */
import { describe, expect, it } from 'vitest';
import {
  checkContract,
  checkSchema,
  checkWorkerEnvelope,
  classifyWorkerResponse,
  validateContract,
  type AnalysisSnapshot,
  type ExportModel,
  type NormalizedTable,
  type ScenarioResult,
} from '../../packages/contracts/src/index.ts';
import { clone, fixture, rules } from './helpers.ts';

const table = () => fixture<NormalizedTable>('normalized-table.example.json');
const snapshot = () => fixture<AnalysisSnapshot>('analysis-snapshot.example.json');
const scenario = () => fixture<ScenarioResult>('scenario-result.example.json');
const exportEn = () => fixture<ExportModel>('export-model.en.example.json');

function expectRules(issues: readonly { rule: string }[], expected: string[]): void {
  const present = rules(issues);
  for (const rule of expected) {
    expect(present, `expected rule ${rule} in ${JSON.stringify(present)}`).toContain(rule);
  }
}

describe('unknown-key rejection (additionalProperties: false)', () => {
  it('table with an extra top-level key is rejected', () => {
    const bad = clone(table()) as unknown as Record<string, unknown>;
    bad['unexpectedField'] = true;
    const issues = checkContract('NormalizedTable', bad);
    expectRules(issues, ['additionalProperties']);
  });

  it('row with an extra key is rejected', () => {
    const bad = clone(table());
    (bad.rows[0] as Record<string, unknown>)['extra'] = 1;
    expectRules(checkContract('NormalizedTable', bad), ['additionalProperties']);
  });
});

describe('decimal refinements', () => {
  it.each(['1e6', '1.2.3', 'abc', '12,5', '', 'NaN', '-0'])(
    'cell value %j is not a legal finite decimal',
    (raw) => {
      const bad = clone(table());
      const row = bad.rows[0]!;
      const decimalColumn = bad.columns.find((c) => c.type === 'decimal')!;
      row.values[decimalColumn.id] = raw;
      const issues = checkContract('NormalizedTable', bad);
      expectRules(issues, ['cell.decimal']);
      expect(issues.length).toBeGreaterThan(0);
    },
  );

  it('decimals beyond 30 significant digits are rejected', () => {
    const bad = clone(table());
    const row = bad.rows[0]!;
    const decimalColumn = bad.columns.find((c) => c.type === 'decimal')!;
    row.values[decimalColumn.id] = '1.234567890123456789012345678901'; // 31 sig digits
    expectRules(checkContract('NormalizedTable', bad), ['cell.significantDigits']);
  });
});

describe('date/range refinements', () => {
  it('impossible calendar date is rejected semantically', () => {
    const bad = clone(table());
    const dateCol = bad.columns.find((c) => c.type === 'date')!;
    bad.rows[0]!.values[dateCol.id] = '2026-02-30';
    expectRules(checkContract('NormalizedTable', bad), ['cell.date']);
  });

  it('reversed selection span is rejected', () => {
    const bad = clone(snapshot());
    const sel = bad.provenance[0]!.selections[0]!;
    sel.spans = [{ start: 1901, end: 1802 }];
    expectRules(checkContract('AnalysisSnapshot', bad, { table: table() }), ['rowSpan.order']);
  });
});

describe('row spans (sorted, disjoint, non-adjacent)', () => {
  function withSpans(spans: { start: number; end: number }[], rowCount: number) {
    const bad = clone(snapshot());
    const sel = bad.provenance[0]!.selections[0]!;
    sel.spans = spans;
    sel.rowCount = rowCount;
    return checkContract('AnalysisSnapshot', bad, { table: table() });
  }

  it('unsorted spans are rejected', () => {
    const issues = withSpans(
      [
        { start: 1802, end: 1901 },
        { start: 1700, end: 1705 },
      ],
      106,
    );
    expectRules(issues, ['rowSpan.canonical']);
  });

  it('overlapping spans are rejected', () => {
    const issues = withSpans(
      [
        { start: 1802, end: 1901 },
        { start: 1850, end: 1950 },
      ],
      201,
    );
    expectRules(issues, ['rowSpan.canonical']);
  });

  it('adjacent spans are rejected (must be merged canonically)', () => {
    const issues = withSpans(
      [
        { start: 1802, end: 1901 },
        { start: 1902, end: 1950 },
      ],
      149,
    );
    expectRules(issues, ['rowSpan.canonical']);
  });
});

describe('row id binding and referential integrity', () => {
  it('row.id must equal ${sheetId}:R${sourceRow}', () => {
    const bad = clone(table());
    bad.rows[0]!.id = 'wrong-id';
    expectRules(checkContract('NormalizedTable', bad), ['row.id.binding']);
  });

  it('metric.provenanceId must name a real proof', () => {
    const bad = clone(snapshot());
    bad.metrics[0]!.provenanceId = 'proof-does-not-exist';
    expectRules(checkContract('AnalysisSnapshot', bad, { table: table() }), ['metric.provenance.missing']);
  });

  it('finding.metricIds must name real metrics', () => {
    const bad = clone(snapshot());
    if (bad.findings.length === 0) return;
    bad.findings[0]!.metricIds.push('metric-nope');
    expectRules(checkContract('AnalysisSnapshot', bad, { table: table() }), ['finding.metricId']);
  });

  it('selection rows must exist in the table', () => {
    const bad = clone(snapshot());
    const sel = bad.provenance[0]!.selections[0]!;
    sel.spans = [{ start: 999999, end: 999999 }];
    sel.rowCount = 1;
    expectRules(checkContract('AnalysisSnapshot', bad, { table: table() }), ['selection.row.missing']);
  });
});

describe('denominator/status triple', () => {
  it('defined metric with null value is rejected', () => {
    const bad = clone(snapshot());
    const m = bad.metrics.find((x) => x.status === 'defined')!;
    m.value = null;
    expectRules(checkContract('AnalysisSnapshot', bad, { table: table() }), ['status.defined.value']);
  });

  it('undefined metric carrying a value is rejected', () => {
    const bad = clone(snapshot());
    const m = bad.metrics.find((x) => x.status === 'defined')!;
    m.status = 'undefined';
    expectRules(checkContract('AnalysisSnapshot', bad, { table: table() }), ['status.undefined.value']);
  });
});

describe('source-hash consistency', () => {
  it('snapshot sourceHash differing from the table is rejected', () => {
    const bad = clone(snapshot());
    bad.sourceHash = 'a'.repeat(64);
    expectRules(checkContract('AnalysisSnapshot', bad, { table: table() }), ['sourceHash.mismatch']);
  });

  it('proof sourceRefs must carry the bound source hash', () => {
    const bad = clone(snapshot());
    (bad.provenance[0]!.sourceRefs[0] as { sourceHash: string }).sourceHash = 'b'.repeat(64);
    expectRules(checkContract('AnalysisSnapshot', bad, { table: table() }), ['sourceHash.mismatch']);
  });
});

describe('scenario bounds and baseline', () => {
  it('costChange above +0.30 is rejected (never silently clamped)', () => {
    const bad = clone(scenario());
    bad.costChange = '0.31';
    expectRules(checkContract('ScenarioResult', bad, { table: table(), snapshot: snapshot() }), ['scenario.bounds']);
  });

  it('costChange below -0.20 is rejected', () => {
    const bad = clone(scenario());
    bad.costChange = '-0.201';
    expectRules(checkContract('ScenarioResult', bad, { table: table(), snapshot: snapshot() }), ['scenario.bounds']);
  });

  it('costChange not an exact multiple of the typed step is rejected', () => {
    const bad = clone(scenario());
    bad.costChange = '0.1001';
    expectRules(checkContract('ScenarioResult', bad, { table: table(), snapshot: snapshot() }), ['scenario.step']);
  });

  it('baselineAnalysisId must equal the baseline snapshot id', () => {
    const bad = clone(scenario());
    bad.baselineAnalysisId = 'analysis-other';
    expectRules(checkContract('ScenarioResult', bad, { table: table(), snapshot: snapshot() }), ['scenario.baseline']);
  });
});

describe('export model', () => {
  it('duplicate slide ids are rejected', () => {
    const bad = clone(exportEn());
    (bad.slides[1] as { id: string }).id = bad.slides[0]!.id;
    expectRules(checkContract('ExportModel', bad), ['id.unique']);
  });

  it('slide referencing an unknown metric is rejected', () => {
    const bad = clone(exportEn());
    const slide = bad.slides.find((s) => s.metricIds.length > 0)!;
    slide.metricIds.push('metric-ghost');
    expectRules(checkContract('ExportModel', bad), ['slide.metricId']);
  });

  it('formula-injection sheet name is rejected', () => {
    const bad = clone(exportEn());
    (bad.sheets[0] as { name: string }).name = '=cmd|evil';
    expectRules(checkContract('ExportModel', bad), ['sheet.name.formula']);
  });
});

describe('stale protocol / envelope guards', () => {
  const request = () =>
    JSON.parse(
      JSON.stringify({
        protocolVersion: 1,
        requestId: 'req-1',
        sessionId: 'session-synthetic',
        revision: 1,
        operation: 'ingest',
        payload: { sourceName: 'f.xlsx', format: 'xlsx', byteLength: 4, binarySlot: 'source' },
      }),
    ) as Record<string, unknown>;

  it('protocolVersion other than 1 is rejected by schema const', () => {
    const bad = request();
    bad['protocolVersion'] = 2;
    expectRules(checkSchema('WorkerRequest', bad), ['const']);
    expect(validateContract('WorkerRequest', bad).ok).toBe(false);
  });

  it('response with mismatched requestId is stale, not processed', () => {
    const res = { protocolVersion: 1, requestId: 'req-old', sessionId: 'session-synthetic', revision: 1, kind: 'progress', stage: 'parse', fraction: 0.5 };
    expect(classifyWorkerResponse(res, { requestId: 'req-1', sessionId: 'session-synthetic', revision: 1 })).toBe('stale');
  });

  it('response with older revision is stale', () => {
    const res = { protocolVersion: 1, requestId: 'req-1', sessionId: 'session-synthetic', revision: 0, kind: 'progress', stage: 'parse', fraction: 0.5 };
    expect(classifyWorkerResponse(res, { requestId: 'req-1', sessionId: 'session-synthetic', revision: 1 })).toBe('stale');
  });

  it('response from another session is stale', () => {
    const res = { protocolVersion: 1, requestId: 'req-1', sessionId: 'other-session', revision: 1, kind: 'progress', stage: 'parse', fraction: 0.5 };
    expect(classifyWorkerResponse(res, { requestId: 'req-1', sessionId: 'session-synthetic', revision: 1 })).toBe('stale');
  });

  it('declared binary slot missing from the envelope is rejected', () => {
    const env = { message: request(), binaries: [] };
    expectRules(checkWorkerEnvelope(env), ['envelope.slot.missing']);
  });

  it('binary slot byteLength mismatch is rejected', () => {
    const env = { message: request(), binaries: [{ slot: 'source', buffer: new ArrayBuffer(9) }] };
    expectRules(checkWorkerEnvelope(env), ['envelope.slot.byteLength']);
  });
});
