/**
 * XLSX adapter behavior: sheet selection, cell mapping, formula/cache
 * preservation, date systems, disclosure warnings and table caps.
 */
import { describe, expect, it } from 'vitest';
import type { RawCell, RawTable } from '../../../packages/contracts/src/index.ts';
import { checkRawTable } from '../../../packages/contracts/src/index.ts';
import { inspectSource, parseSource } from '../../../packages/ingest/src/index.ts';
import { buildXlsx } from '../../../fixtures/ingest/xlsxkit.mjs';
import { expectIngestError, fixtureBytes, toArrayBuffer } from './helpers.ts';

const DEFAULT_OPTS = { allowHiddenSheet: false };
const NOOP = () => {};

async function parse(name: string, options = DEFAULT_OPTS): Promise<RawTable> {
  const table = await parseSource(toArrayBuffer(fixtureBytes(name)), name, options, NOOP);
  expect(checkRawTable(table)).toEqual([]);
  return table;
}

function cellAt(table: RawTable, row: number, column: number): RawCell | undefined {
  return table.cells.find((c) => c.row === row && c.column === column);
}

describe('xlsx: cell types and formulas', () => {
  it('maps text/number/boolean/formula/error cells with physical coords', async () => {
    const t = await parse('types-and-formulas.xlsx');
    expect(t.sourceRef.sheetName).toBe('Data');
    expect(t.sourceRef.headerRow).toBe(1);
    expect(t.sourceRef.range).toEqual({ firstRow: 1, lastRow: 4, firstColumn: 1, lastColumn: 5 });

    expect(cellAt(t, 1, 1)).toMatchObject({ raw: 'name', type: 'text' });
    expect(cellAt(t, 2, 1)).toMatchObject({ raw: 'widget', type: 'text' });
    expect(cellAt(t, 2, 2)).toMatchObject({ raw: '4', type: 'number' });
    expect(cellAt(t, 2, 3)).toMatchObject({ raw: '2.5', type: 'number' });
    expect(cellAt(t, 2, 5)).toMatchObject({ raw: true, type: 'boolean' });
    expect(cellAt(t, 3, 5)).toMatchObject({ raw: false, type: 'boolean' });
    expect(cellAt(t, 4, 3)).toMatchObject({ raw: '#DIV/0!', type: 'error' });
  });

  it('preserves formula text and cached value without evaluating', async () => {
    const t = await parse('types-and-formulas.xlsx');
    const cached = cellAt(t, 2, 4);
    expect(cached).toMatchObject({ type: 'formula', formula: '=B2*C2', raw: '=B2*C2', cachedValue: '10' });

    const noCache = cellAt(t, 3, 4);
    expect(noCache).toMatchObject({ type: 'formula', formula: '=B3*C3' });
    expect(noCache?.cachedValue).toBeNull();

    expect(t.warnings).toContain('ingest.warn.formula-cells');
  });

  it('emits explicit blank cells for missing header positions', async () => {
    const t = await parse('dup-headers.xlsx');
    expect(cellAt(t, 1, 3)).toMatchObject({ type: 'blank', raw: null });
    // duplicate header texts are preserved verbatim — labeling is normalize's job
    expect(cellAt(t, 1, 1)?.raw).toBe('id');
    expect(cellAt(t, 1, 2)?.raw).toBe('id');
    expect(cellAt(t, 1, 4)?.raw).toBe('amount');
    expect(cellAt(t, 1, 5)?.raw).toBe('amount');
  });
});

describe('xlsx: sheet selection', () => {
  it('defaults to the first visible sheet', async () => {
    const t = await parse('multi-sheet-hidden.xlsx');
    expect(t.sourceRef.sheetId).toBe('S0');
    expect(t.sourceRef.sheetName).toBe('Cover');
    expect(t.warnings).toContain('ingest.warn.hidden-sheets-excluded');
  });

  it('rejects hidden-sheet selection without opt-in', async () => {
    await expectIngestError(
      parseSource(toArrayBuffer(fixtureBytes('multi-sheet-hidden.xlsx')), 'multi-sheet-hidden.xlsx', { ...DEFAULT_OPTS, selectedSheetId: 'S1' }, NOOP),
      'UNSUPPORTED',
      'xlsx.sheet-hidden-requires-opt-in',
    );
  });

  it('parses a hidden sheet with explicit opt-in, flagged', async () => {
    const t = await parse('multi-sheet-hidden.xlsx', { allowHiddenSheet: true, selectedSheetId: 'S1' });
    expect(t.sourceRef.sheetId).toBe('S1');
    expect(t.sourceRef.sheetName).toBe('Payload');
    expect(cellAt(t, 2, 1)?.raw).toBe('a');
    expect(t.warnings).toContain('ingest.warn.hidden-sheet-selected');
  });

  it('rejects very-hidden sheets without opt-in', async () => {
    await expectIngestError(
      parseSource(toArrayBuffer(fixtureBytes('multi-sheet-hidden.xlsx')), 'm.xlsx', { ...DEFAULT_OPTS, selectedSheetId: 'S2' }, NOOP),
      'UNSUPPORTED',
    );
  });

  it('rejects unknown sheet ids', async () => {
    await expectIngestError(
      parseSource(toArrayBuffer(fixtureBytes('multi-sheet-hidden.xlsx')), 'm.xlsx', { ...DEFAULT_OPTS, selectedSheetId: 'S99' }, NOOP),
      'INVALID_FILE',
      'xlsx.sheet-not-found',
    );
  });

  it('inspectSource lists sheets, visibility, dimensions and a bounded preview', async () => {
    const insp = await inspectSource(toArrayBuffer(fixtureBytes('multi-sheet-hidden.xlsx')), 'm.xlsx');
    expect(insp.format).toBe('xlsx');
    expect(insp.sheets.map((s) => s.name)).toEqual(['Cover', 'Payload', 'Secrets']);
    expect(insp.sheets.map((s) => s.visibility)).toEqual(['visible', 'hidden', 'very-hidden']);
    expect(insp.defaultSheetId).toBe('S0');
    expect(insp.hiddenSheets.map((s) => s.sheetId)).toEqual(['S1', 'S2']);
    expect(insp.previewRows.length).toBeGreaterThan(0);
    expect(insp.warnings).toContain('ingest.warn.hidden-sheets-excluded');
  });

  it('inspectSource on an all-hidden workbook returns the sheet list with no default', async () => {
    const bytes = buildXlsx({
      sheets: [
        { name: 'Payload', hidden: true, rows: [['k', 'v'], ['a', 1]] },
        { name: 'Secrets', veryHidden: true, rows: [['x'], [9]] },
      ],
    });
    const insp = await inspectSource(toArrayBuffer(new Uint8Array(bytes)), 'all-hidden.xlsx');
    expect(insp.sheets.map((s) => s.visibility)).toEqual(['hidden', 'very-hidden']);
    expect(insp.defaultSheetId).toBeNull();
    expect(insp.hiddenSheets.map((s) => s.sheetId)).toEqual(['S0', 'S1']);
    expect(insp.previewRows).toEqual([]);
    expect(insp.warnings).toContain('ingest.warn.hidden-sheets-excluded');
    // The explicit opt-in path still parses the hidden sheet.
    const t = await parseSource(toArrayBuffer(new Uint8Array(bytes)), 'all-hidden.xlsx', {
      allowHiddenSheet: true,
      selectedSheetId: 'S0',
    }, NOOP);
    expect(t.sourceRef.sheetName).toBe('Payload');
    expect(t.cells.length).toBeGreaterThan(0);
  });
});

describe('xlsx: header row and ranges', () => {
  it('auto-detects the first nonempty row as header', async () => {
    const t = await parse('non-row1-header.xlsx');
    expect(t.sourceRef.headerRow).toBe(4);
    expect(t.sourceRef.range.firstRow).toBe(4);
    expect(cellAt(t, 4, 1)?.raw).toBe('id');
    expect(cellAt(t, 5, 3)?.raw).toBe('10');
  });

  it('honors an explicit headerRow', async () => {
    const t = await parse('non-row1-header.xlsx', { ...DEFAULT_OPTS, headerRow: 1 });
    expect(t.sourceRef.headerRow).toBe(1);
    expect(t.sourceRef.range.firstRow).toBe(1);
    expect(cellAt(t, 1, 1)?.raw).toBe('Quarterly export');
  });

  it('rejects headerRow beyond content', async () => {
    await expectIngestError(
      parseSource(toArrayBuffer(fixtureBytes('non-row1-header.xlsx')), 'n.xlsx', { ...DEFAULT_OPTS, headerRow: 99 }, NOOP),
      'INVALID_FILE',
      'xlsx.header-row-beyond-content',
    );
  });

  it('honors explicit column ranges', async () => {
    const t = await parse('non-row1-header.xlsx', { ...DEFAULT_OPTS, headerRow: 4, firstColumn: 2, lastColumn: 3 });
    expect(t.sourceRef.range).toEqual({ firstRow: 4, lastRow: 8, firstColumn: 2, lastColumn: 3 });
    expect(cellAt(t, 5, 1)).toBeUndefined();
    expect(cellAt(t, 5, 2)?.raw).toBe('alpha');
  });
});

describe('xlsx: date systems', () => {
  it('reports 1900 system, keeps serials raw, flags serial 60 and 0', async () => {
    const t = await parse('dates-1900.xlsx');
    expect(t.dateSystem).toBe('1900');
    expect(cellAt(t, 2, 2)).toMatchObject({ type: 'date', raw: '1' });
    expect(cellAt(t, 3, 2)).toMatchObject({ type: 'date', raw: '60' }); // pseudo-date, never converted
    expect(cellAt(t, 4, 2)).toMatchObject({ type: 'date', raw: '61' });
    expect(t.warnings).toContain('ingest.warn.invalid-date-serial');
  });

  it('reports 1904 system; serial 60 is a real date there', async () => {
    const t = await parse('dates-1904.xlsx');
    expect(t.dateSystem).toBe('1904');
    expect(cellAt(t, 2, 2)).toMatchObject({ type: 'date', raw: '0' });
    expect(cellAt(t, 3, 2)).toMatchObject({ type: 'date', raw: '60' });
    expect(t.warnings).not.toContain('ingest.warn.invalid-date-serial');
  });
});

describe('xlsx: disclosure warnings', () => {
  it('warns on merged cells, hidden rows and hidden columns in range', async () => {
    const t = await parse('merged-and-hidden.xlsx');
    expect(t.warnings).toContain('ingest.warn.merged-cells-in-range');
    expect(t.warnings).toContain('ingest.warn.hidden-rows-in-range');
    expect(t.warnings).toContain('ingest.warn.hidden-columns-in-range');
  });

  it('does not forward-fill merged cells', async () => {
    const t = await parse('merged-and-hidden.xlsx');
    expect(cellAt(t, 2, 1)?.raw).toBe('merged');
    expect(cellAt(t, 2, 2)).toBeUndefined(); // merged-into cell stays absent
  });

  it('discloses external references without resolving them', async () => {
    const t = await parse('external-refs.xlsx');
    expect(t.warnings).toContain('ingest.warn.external-refs-ignored');
    const f = cellAt(t, 2, 2);
    expect(f).toMatchObject({ type: 'formula', formula: '=[1]Sheet1!A1*2', cachedValue: '4' });
  });
});

describe('xlsx: caps', () => {
  it('rejects >100 columns', async () => {
    await expectIngestError(parseSource(toArrayBuffer(fixtureBytes('wide-101.xlsx')), 'w.xlsx', DEFAULT_OPTS, NOOP), 'LIMIT_EXCEEDED', 'columns');
  });

  it('rejects >50k rows including header', async () => {
    await expectIngestError(
      parseSource(toArrayBuffer(fixtureBytes('many-rows.xlsx')), 'm.xlsx', DEFAULT_OPTS, NOOP),
      'LIMIT_EXCEEDED',
      'rows-including-header',
    );
  }, 60_000);
});
