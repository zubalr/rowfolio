/**
 * XLSX leg of the pipeline: a synthetic workbook built with the frozen
 * ExcelJS dependency is read back through real bytes, mapped through the
 * test bridge, and run through the owned pipeline. A logical CSV twin
 * proves the two legs agree numerically.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import ExcelJS from '../../../packages/export-xlsx/node_modules/exceljs';
import { compareDecimal } from '../../../packages/contracts/src/index.ts';
import { profileTable } from '../../../packages/normalize/src/index.ts';
import { normalizeTable } from '../../../packages/normalize/src/index.ts';
import { rawFromXlsxWorkbook } from './bridge.ts';
import { CREATED_AT, edgeDefinition, edgeScope } from './fixtures.ts';
import { runPipeline, type PipelineResult } from './pipeline.ts';
import { rawFromCsvBytes } from './bridge.ts';
import { sha256Hex } from './fixtures.ts';

const SHEET = 'Data';

async function syntheticXlsx(): Promise<{ bytes: Uint8Array; hash: string }> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET);
  sheet.addRow(['id', 'date', 'revenue', 'flag', 'note']);
  sheet.addRow(['X-1', '2026-06-01', 100.5, true, 'cash']);
  sheet.addRow(['X-2', '2026-06-02', 1234567890123456, false, 'big int']);
  sheet.addRow(['X-3', '2026-06-03', null, null, 'blank measure']);
  sheet.addRow(['X-1', '2026-06-01', 100.5, true, 'cash']);
  sheet.getCell('C6').value = { formula: 'SUM(C2:C3)', result: 1234567890123556.5 } as never;
  sheet.getCell('A6').value = 'X-4';
  sheet.getCell('B6').value = '2026-06-04';
  sheet.getCell('D6').value = false;
  sheet.getCell('E6').value = '=HYPERLINK("http://evil.invalid","x")';
  sheet.addRow(['X-5', '2026-06-05', '12345678901234567890.12', true, 'long decimal as text']);
  const raw = new Uint8Array((await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer);
  return { bytes: raw, hash: sha256Hex(raw) };
}

const TWIN_CSV = [
  'id,date,revenue,flag,note',
  'X-1,2026-06-01,100.5,true,cash',
  'X-2,2026-06-02,1234567890123456,false,big int',
  'X-3,2026-06-03,,,blank measure',
  'X-1,2026-06-01,100.5,true,cash',
].join('\n');

let xlsxResult: PipelineResult;

beforeAll(async () => {
  const { bytes, hash } = await syntheticXlsx();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(bytes as unknown as ArrayBuffer);
  const raw = await rawFromXlsxWorkbook(loaded as never, {
    sourceName: 'synthetic.xlsx',
    sourceHash: hash,
    sheetName: SHEET,
  });
  const columns = profileTable(raw).proposedColumns.map((column) => {
    if (column.id === 'revenue') {
      return {
        ...column,
        confirmed: true,
        role: 'measure' as const,
        additive: true,
        unit: { kind: 'currency' as const, label: 'USD', currency: 'USD' as const },
      };
    }
    return { ...column, confirmed: true };
  });
  xlsxResult = await runPipeline({
    raw,
    approvals: { issueIds: [], columns, useUnverifiedFormulaCaches: [] },
    scope: { ...edgeScope(), tableId: 'raw-bridge-xlsx' },
    definition: {
      ...edgeDefinition(),
      // Single-measure sheet: revenue doubles as the cost leg so the math
      // path executes; margin sign is not asserted here.
      requiresMetricIds: ['total-revenue', 'total-revenue'],
    },
    costChange: '0.10',
    createdAt: CREATED_AT,
  });
}, 120000);

describe('xlsx leg', () => {
  it('maps real workbook bytes into the pipeline with exact values', () => {
    const rows = xlsxResult.table.rows;
    checkRows(rows.length === 6, `${rows.length} rows retained (dup excluded)`);
    const byId = (id: string): string | boolean | null =>
      (rows.find((r) => r.values['id'] === id)?.values['revenue'] as string | boolean | null) ?? null;
    checkRows(compareDecimal(String(byId('X-1')), '100.5') === 0, 'number cell exact');
    checkRows(compareDecimal(String(byId('X-2')), '1234567890123456') === 0, 'large int exact through doubles');
    checkRows(byId('X-3') === null, 'blank measure stays missing');
    const long = rows.find((r) => r.values['id'] === 'X-5')?.values['revenue'];
    checkRows(long === '12345678901234567890.12', 'long decimal string preserved verbatim');
    const evil = rows.find((r) => r.values['id'] === 'X-4')?.values['note'];
    checkRows(evil === '=HYPERLINK("http://evil.invalid","x")', 'formula-like text stays data');
    const formula = rows.find((r) => r.values['id'] === 'X-4')?.values['revenue'];
    checkRows(formula === null, 'unverified formula cache excluded by default');
    const caches = xlsxResult.table.qualityIssues.filter((q) => q.kind === 'formula-cache');
    checkRows(caches.length === 1, 'formula cache traced in ledger');
  });

  it('honors explicit opt-in to unverified cached values with a warning', async () => {
    const { bytes, hash } = await syntheticXlsx();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(bytes as unknown as ArrayBuffer);
    const raw = await rawFromXlsxWorkbook(loaded as never, {
      sourceName: 'synthetic.xlsx', sourceHash: hash, sheetName: SHEET,
    });
    const profile = profileTable(raw);
    const cacheId = profile.issues.find((q) => q.kind === 'formula-cache')?.id;
    expect(cacheId).toBeDefined();
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
      approvals: { issueIds: [cacheId as string], columns, useUnverifiedFormulaCaches: ['revenue'] },
      scope: { ...edgeScope(), tableId: 'raw-bridge-xlsx' },
      definition: {
        ...edgeDefinition(),
        // Single-measure sheet: revenue doubles as the cost leg so the math
      // path executes; margin sign is not asserted here.
      requiresMetricIds: ['total-revenue', 'total-revenue'],
      },
      costChange: '0.10',
      createdAt: CREATED_AT,
    });
    const cached = result.table.rows.find((r) => r.values['id'] === 'X-4')?.values['revenue'];
    expect(String(cached)).toBe('1234567890123556.5');
    const metric = result.snapshot.metrics.find((m) => m.id === 'total-revenue');
    expect(metric?.warnings).toContain('limitations.cache');
  }, 120000);

  it('agrees numerically with the CSV twin leg', () => {
    const bytes = new TextEncoder().encode(TWIN_CSV);
    const twin = rawFromCsvBytes(bytes, { sourceName: 'twin.csv', sourceHash: sha256Hex(bytes) });
    const profile = profileTable(twin);
    const columns = profile.proposedColumns.map((c) => ({ ...c, confirmed: true }));
    expect(columns.map((c) => c.id)).toEqual(['id', 'date', 'revenue', 'flag', 'note']);
    const twinTable = normalizeTable(twin, {
      issueIds: profile.issues.filter((q) => q.kind === 'duplicate').map((q) => q.id),
      columns,
      useUnverifiedFormulaCaches: [],
    });
    // Twin dedupes to 3 rows; each matches an xlsx-leg row numerically.
    expect(twinTable.rows).toHaveLength(3);
    for (const twinRow of twinTable.rows) {
      const id = twinRow.values['id'];
      const sibling = xlsxResult.table.rows.find((r) => r.values['id'] === id);
      expect(sibling, `sibling ${String(id)}`).toBeDefined();
      const a = twinRow.values['revenue'];
      const b = sibling?.values['revenue'];
      if (a === null || b === null) {
        expect(a).toBe(b);
      } else {
        expect(compareDecimal(String(a), String(b)) === 0, `revenue ${String(id)}`).toBe(true);
      }
      expect(sibling?.values['flag']).toBe(twinRow.values['flag']);
      expect(sibling?.values['note']).toBe(twinRow.values['note']);
    }
  });
});

function checkRows(passed: boolean, detail: string): void {
  expect(passed, detail).toBe(true);
}
