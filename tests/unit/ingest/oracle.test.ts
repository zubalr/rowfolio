/**
 * Oracle reconciliation: parse the canonical sample workbook and its CSV
 * twin, then prove every emitted raw cell equals the independently
 * generated oracle rows (fixtures/sample/sample_rows.json), and that the
 * physical spans match fixtures/golden/expected_source_spans.json.
 */
import { describe, expect, it } from 'vitest';
import type { RawTable } from '../../../packages/contracts/src/index.ts';
import { checkRawTable } from '../../../packages/contracts/src/index.ts';
import { parseSource, inspectSource } from '../../../packages/ingest/src/index.ts';
import { fixtureJson, GOLDEN_FIXTURES, SAMPLE_FIXTURES, sampleBytes, toArrayBuffer, progressRecorder } from './helpers.ts';

const OPTS = { allowHiddenSheet: false };

interface Oracle {
  headers: string[];
  rows: Record<string, unknown>[];
}

const oracle = fixtureJson<Oracle>(SAMPLE_FIXTURES, 'sample_rows.json');
const spans = fixtureJson<Record<string, unknown>>(GOLDEN_FIXTURES, 'expected_source_spans.json');
const hashes = fixtureJson<{ files: Record<string, string> }>(GOLDEN_FIXTURES, 'fixture_hashes.json');

function cellMap(t: RawTable): Map<string, RawTable['cells'][number]> {
  const m = new Map<string, RawTable['cells'][number]>();
  for (const c of t.cells) m.set(`${c.row}:${c.column}`, c);
  return m;
}

function reconcile(table: RawTable): void {
  // header row = 1; oracle rows occupy physical rows 2..2418.
  const map = cellMap(table);
  expect(table.sourceRef.headerRow).toBe(1);
  expect(table.sourceRef.range.firstRow).toBe(1);
  expect(table.sourceRef.range.lastRow).toBe(2418);
  expect(table.sourceRef.range.firstColumn).toBe(1);
  expect(table.sourceRef.range.lastColumn).toBe(oracle.headers.length);

  for (const [c, header] of oracle.headers.entries()) {
    expect(map.get(`1:${c + 1}`)?.raw).toBe(header);
  }
  for (const [i, row] of oracle.rows.entries()) {
    const physical = i + 2;
    for (const [c, header] of oracle.headers.entries()) {
      const cell = map.get(`${physical}:${c + 1}`);
      const expected = row[header];
      if (expected === null || expected === undefined) {
        // absent oracle value → blank cell or no cell
        expect(cell === undefined || cell.raw === null, `cell ${physical}:${c + 1} (${header})`).toBe(true);
        continue;
      }
      expect(cell, `cell ${physical}:${c + 1} (${header})`).toBeDefined();
      if (cell?.type === 'number') {
        // XLSX stores IEEE754 doubles — '9916.70' and '9916.7' are the same number.
        expect(Number(cell.raw)).toBe(Number(expected));
      } else {
        expect(cell?.raw).toBe(String(expected));
      }
    }
  }
  // no cells outside the oracle's row coverage
  const dataRows = new Set(table.cells.filter((c) => c.row > 1).map((c) => c.row));
  expect(dataRows.size).toBe(oracle.rows.length);
}

describe('oracle: sample_operations', () => {
  it('xlsx bytes hash matches the published fixture hash', async () => {
    const { sha256Hex } = await import('../../../packages/contracts/src/index.ts');
    const buf = toArrayBuffer(sampleBytes('sample_operations.xlsx'));
    expect(await sha256Hex(buf)).toBe(hashes.files['sample_operations.xlsx']);
  });

  it('xlsx RawTable reconciles row-for-row with the oracle', async () => {
    const { fn } = progressRecorder();
    const t = await parseSource(toArrayBuffer(sampleBytes('sample_operations.xlsx')), 'sample_operations.xlsx', OPTS, fn);
    expect(checkRawTable(t)).toEqual([]);
    reconcile(t);
  }, 120_000);

  it('csv RawTable reconciles row-for-row with the oracle', async () => {
    const t = await parseSource(toArrayBuffer(sampleBytes('sample_operations.csv')), 'sample_operations.csv', OPTS, () => {});
    expect(checkRawTable(t)).toEqual([]);
    reconcile(t);
    expect(t.sourceRef.format).toBe('csv');
  }, 120_000);

  it('physical source spans match the golden spans', async () => {
    const t = await parseSource(toArrayBuffer(sampleBytes('sample_operations.xlsx')), 's.xlsx', OPTS, () => {});
    // North June revenue block lives at Operations rows 1802..1901 — cells exist at both ends.
    const ns = spans['northJuneRevenue'] as { spans: { start: number; end: number }[] };
    const { start, end } = ns.spans[0] as { start: number; end: number };
    const revenueCol = oracle.headers.indexOf('revenue') + 1;
    const map = cellMap(t);
    expect(map.get(`${start}:${revenueCol}`)).toBeDefined();
    expect(map.get(`${end}:${revenueCol}`)).toBeDefined();
    expect(map.get(`${start - 1}:${revenueCol}`)).toBeDefined(); // May row still present
    // east anomaly coordinate is a real cell
    const ea = spans['eastAnomaly'] as { sourceRow: number };
    expect(map.get(`${ea.sourceRow}:1`)).toBeDefined();
  }, 120_000);

  it('inspectSource exposes all three sheets and bounded preview', async () => {
    const insp = await inspectSource(toArrayBuffer(sampleBytes('sample_operations.xlsx')), 's.xlsx');
    expect(insp.sheets.map((s) => s.name)).toEqual(['Operations', 'Dictionary', 'Calendar']);
    expect(insp.sheets[0]?.dimensions).toEqual({ firstRow: 1, lastRow: 2418, firstColumn: 1, lastColumn: 11 });
    expect(insp.previewRowNumbers.length).toBeLessThanOrEqual(30);
    expect(insp.previewRows.length).toBeGreaterThan(0);
    expect(insp.defaultSheetId).toBe('S0');
  }, 120_000);
});
