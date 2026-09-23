/**
 * Hostile inputs through the full pipeline: injection strings, duplicate
 * headers, oversized cells, and corrupt bytes must either flow through as
 * inert data with ledger traces or fail loudly at the bridge — never
 * silently accepted, never executed.
 */
import { describe, expect, it } from 'vitest';
import { compareDecimal } from '../../../packages/contracts/src/index.ts';
import { sumField } from '../../../packages/analysis/src/index.ts';
import { normalizeTable, profileTable } from '../../../packages/normalize/src/index.ts';
import { BridgeError, rawFromCsvBytes } from './bridge.ts';
import { CREATED_AT, edgeDefinition, edgeScope, sha256Hex } from './fixtures.ts';
import { runPipeline } from './pipeline.ts';
import { entryText, unzip } from './zip.ts';

const INJECTION_CSV = [
  'id,note,revenue',
  'F-1,=cmd|"/c calc"!A0,10.00',
  'F-2,+SUM(A1:A2),20.00',
  'F-3,-2+3,30.00',
  'F-4,"@SUM(1,1)",40.00',
  'F-5,http://evil.invalid/x,50.00',
  'F-6,D0\u202eEVIL,60.00',
  'F-7,\u0661\u0662\u0663,70.00',
].join('\n');

const DUP_HEADER_CSV = [
  'revenue,revenue, Revenue ',
  '100.00,150.00,200.00',
  '80.00,90.00,110.00',
  '120.00,110.00,130.00',
].join('\n');

function rawOf(name: string, text: string): ReturnType<typeof rawFromCsvBytes> {
  const bytes = new TextEncoder().encode(text);
  return rawFromCsvBytes(bytes, { sourceName: name, sourceHash: sha256Hex(bytes) });
}

describe('hostile pipeline', () => {
  it('carries injection strings to inert artifact cells with ledger honesty', async () => {
    const raw = rawOf('injection.csv', INJECTION_CSV);
    const profile = profileTable(raw);
    const columns = profile.proposedColumns.map((column) => {
      if (column.id === 'revenue') {
        return {
          ...column, confirmed: true, role: 'measure' as const, additive: true,
          unit: { kind: 'currency' as const, label: 'USD', currency: 'USD' as const },
        };
      }
      return { ...column, confirmed: true };
    });
    const result = await runPipeline({
      raw,
      approvals: { issueIds: [], columns, useUnverifiedFormulaCaches: [] },
      scope: { ...edgeScope(), tableId: 'raw-bridge-csv' },
      definition: {
        ...edgeDefinition(),
        // Single-measure sheet: revenue doubles as the cost leg so the math
        // path executes; only injection safety is asserted here.
        requiresMetricIds: ['total-revenue', 'total-revenue'],
      },
      costChange: '0.10',
      createdAt: CREATED_AT,
    });
    // Hostile text alone cannot break the pipeline or mint metrics.
    expect(result.table.rows).toHaveLength(7);
    const xlsx = unzip(new Uint8Array(result.xlsx.bytes));
    const strings = entryText(xlsx, 'xl/sharedStrings.xml');
    for (const hostile of ['=cmd|', '+SUM(A1:A2)', '@SUM(1,1)', 'http://evil.invalid', '‮', '١٢٣']) {
      expect(strings, `preserved ${JSON.stringify(hostile)}`).toContain(hostile);
    }
    for (const [name, data] of xlsx) {
      if (!name.startsWith('xl/worksheets/')) continue;
      const xml = Buffer.from(data).toString('utf8');
      for (const match of xml.matchAll(/<f>(.*?)<\/f>/g)) {
        expect(match[1]).not.toContain('cmd|');
        expect(match[1]).not.toContain('SUM(A1:A2)');
      }
    }
    const pptx = unzip(new Uint8Array(result.pptx.bytes));
    for (const [name, data] of pptx) {
      if (name.endsWith('.rels')) {
        expect(Buffer.from(data).toString('utf8')).not.toContain('TargetMode="External"');
      }
    }
  }, 120000);

  it('keeps duplicate headers disjoint with independent sums', async () => {
    const raw = rawOf('dupes.csv', DUP_HEADER_CSV);
    const profile = profileTable(raw);
    expect(profile.proposedColumns.map((c) => c.id)).toEqual(['revenue', 'revenue__2', 'revenue__3']);
    const columns = profile.proposedColumns.map((c) => ({
      ...c,
      confirmed: true,
      role: 'measure' as const,
      additive: true,
      unit: { kind: 'currency' as const, label: 'USD', currency: 'USD' as const },
    }));
    const table = normalizeTable(raw, { issueIds: [], columns, useUnverifiedFormulaCaches: [] });
    // Column 1 sums to 300.00, column 2 to 350.00, column 3 to 440.00 —
    // never combined.
    expect(compareDecimal(sumField(table.rows, 'revenue').total, '300.00')).toBe(0);
    expect(compareDecimal(sumField(table.rows, 'revenue__2').total, '350.00')).toBe(0);
    expect(compareDecimal(sumField(table.rows, 'revenue__3').total, '440.00')).toBe(0);
  });

  it('rejects oversized and corrupt input at the bridge with typed errors', () => {
    const big = new TextEncoder().encode(`a\n${'x'.repeat(32001)}`);
    expect(() => rawFromCsvBytes(big, { sourceName: 'big.csv', sourceHash: sha256Hex(big) }))
      .toThrowError(BridgeError);
    const empty = new TextEncoder().encode('');
    expect(() => rawFromCsvBytes(empty, { sourceName: 'empty.csv', sourceHash: sha256Hex(empty) }))
      .toThrowError(BridgeError);
    const badUtf8 = new Uint8Array([0xff, 0xfe, 0x0a]);
    expect(() => rawFromCsvBytes(badUtf8, { sourceName: 'bad.csv', sourceHash: sha256Hex(badUtf8) }))
      .toThrow();
  });
});
