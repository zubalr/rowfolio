/**
 * Behavioural edge cases for profiling and normalization: legitimate
 * repeats, Unicode/digit handling, ambiguous dates, precision envelopes,
 * formula-cache gating, header repair and approval validation.
 */
import { describe, expect, it } from 'vitest';
import type { Column, RawCell, RawTable } from '../../../packages/contracts/src/index.ts';
import type { ApprovalPlan } from '../../../packages/contracts/interfaces.ts';
import {
  columnLetter,
  foldKey,
  normalizeTable,
  NormalizeError,
  profileTable,
  significantDigitsOf,
  slugColumnId,
} from '../../../packages/normalize/src/index.ts';

let nextId = 0;

function rawTable(headers: string[], rows: string[][], opts?: { types?: RawCell['type'][] }): RawTable {
  nextId += 1;
  const cells: RawCell[] = [];
  headers.forEach((h, c) => {
    cells.push({ row: 1, column: c + 1, raw: h, type: 'text', formula: null, cachedValue: null });
  });
  rows.forEach((values, r) => {
    values.forEach((value, c) => {
      cells.push({
        row: r + 2,
        column: c + 1,
        raw: value,
        type: opts?.types?.[c] ?? 'text',
        formula: null,
        cachedValue: null,
      });
    });
  });
  return {
    id: `raw-${nextId}`,
    sourceRef: {
      id: 'source-test',
      sourceHash: '0'.repeat(64),
      workbookName: 'test.csv',
      format: 'csv',
      sheetId: 'S0',
      sheetName: 'Sheet1',
      headerRow: 1,
      range: { firstRow: 1, lastRow: rows.length + 1, firstColumn: 1, lastColumn: headers.length },
    },
    cells,
    dateSystem: 'not-applicable',
    warnings: [],
  };
}

const EMPTY_PLAN: ApprovalPlan = { issueIds: [], columns: [], useUnverifiedFormulaCaches: [] };

function confirmedColumns(raw: RawTable): Column[] {
  return profileTable(raw).proposedColumns.map((c) => ({ ...c, confirmed: true }));
}

describe('header handling', () => {
  it('names blank headers Column {letter} and proposes confirmation', () => {
    const raw = rawTable(['revenue', ''], [['10', 'x']]);
    const profile = profileTable(raw);
    expect(profile.proposedColumns[1]?.label).toBe('Column B');
    expect(profile.issues.some((q) => q.kind === 'header')).toBe(true);
  });

  it('assigns stable ordinal ids to duplicate headers instead of overwriting', () => {
    const raw = rawTable(['revenue', 'revenue'], [['10', '20']]);
    const profile = profileTable(raw);
    expect(profile.proposedColumns.map((c) => c.id)).toEqual(['revenue', 'revenue__2']);
  });

  it('flags fold-ambiguous labels without merging them', () => {
    const raw = rawTable(['Region', ' region '], [['North', 'North']]);
    const profile = profileTable(raw);
    expect(profile.issues.some((q) => q.id === 'quality-header-ambiguous-2')).toBe(true);
    expect(profile.proposedColumns.map((c) => c.id)).toEqual(['region', 'region__2']);
  });
});

describe('duplicates', () => {
  const headers = ['operation_id', 'revenue'];
  const rows = [
    ['OP-1', '10'],
    ['OP-1', '10'],
    ['OP-1', '11'],
  ];

  it('proposes exact repeats as candidates but never deletes without approval', () => {
    const profile = profileTable(rawTable(headers, rows));
    expect(profile.issues.map((q) => q.id)).toContain('quality-duplicate-3');
    const table = normalizeTable(rawTable(headers, rows), EMPTY_PLAN);
    expect(table.rows).toHaveLength(3);
  });

  it('excludes only the approved copy, keeping the earliest physical row', () => {
    const raw = rawTable(headers, rows);
    const table = normalizeTable(raw, {
      ...EMPTY_PLAN,
      issueIds: ['quality-duplicate-3'],
      columns: confirmedColumns(raw),
    });
    expect(table.rows.map((r) => r.sourceRow)).toEqual([2, 4]);
  });

  it('rejects approvals that reference unknown issue ids', () => {
    expect(() => normalizeTable(rawTable(headers, rows), { ...EMPTY_PLAN, issueIds: ['quality-nope-1'] }))
      .toThrow(NormalizeError);
  });
});

describe('unicode and digits', () => {
  it('never merges Arabic-Indic digits into Latin numerics', () => {
    const raw = rawTable(['amount'], [['100'], ['٢٠٠']]);
    const profile = profileTable(raw);
    expect(profile.proposedColumns[0]?.type).not.toBe('integer');
    const table = normalizeTable(raw, EMPTY_PLAN);
    expect(table.rows[1]?.values['amount']).toBe('٢٠٠');
  });

  it('uses NFC comparison keys without stripping diacritics', () => {
    expect(foldKey('é')).toBe('é'.normalize('NFC').toLowerCase());
    const raw = rawTable(['city'], [['Montréal'], ['Montreal']]);
    const profile = profileTable(raw);
    expect(profile.issues.filter((q) => q.kind === 'category')).toHaveLength(0);
  });

  it('keeps leading-zero identifiers as text', () => {
    const raw = rawTable(['code'], [['00123'], ['00456']]);
    const profile = profileTable(raw);
    // Leading zeros never parse as canonical decimals, so the column stays
    // text; the identifier role still marks it unaggregatable.
    expect(profile.proposedColumns[0]?.type).toBe('text');
    expect(profile.proposedColumns[0]?.role).toBe('identifier');
    const table = normalizeTable(raw, EMPTY_PLAN);
    expect(table.rows[0]?.values['code']).toBe('00123');
  });
});

describe('dates and precision', () => {
  it('leaves slash dates ambiguous until confirmed', () => {
    const raw = rawTable(['date'], [['03/04/2026']]);
    const profile = profileTable(raw);
    expect(profile.issues.some((q) => q.kind === 'ambiguous-date')).toBe(true);
    const table = normalizeTable(raw, EMPTY_PLAN);
    expect(table.rows[0]?.values['date']).toBe('03/04/2026');
  });

  it('accepts strict ISO dates without proposals', () => {
    const raw = rawTable(['date'], [['2026-03-04']]);
    const profile = profileTable(raw);
    expect(profile.proposedColumns[0]?.type).toBe('date');
    expect(profile.issues.filter((q) => q.kind === 'ambiguous-date')).toHaveLength(0);
  });

  it('flags over-precision cells for confirmation', () => {
    const raw = rawTable(['amount'], [['1'.repeat(31)]], { types: ['text'] });
    expect(profileTable(raw).issues.some((q) => q.kind === 'precision')).toBe(true);
    const excel = rawTable(['amount'], [['1'.repeat(16)]], { types: ['number'] });
    expect(profileTable(excel).issues.some((q) => q.kind === 'precision')).toBe(true);
    const ok = rawTable(['amount'], [['1'.repeat(15)]], { types: ['number'] });
    expect(profileTable(ok).issues.some((q) => q.kind === 'precision')).toBe(false);
  });
});

describe('formula caches and missingness', () => {
  it('excludes unverified formula caches by default and honors explicit opt-in', () => {
    const formula = rawTable(['revenue'], [['ignored']]);
    const cell = formula.cells.find((c) => c.row === 2 && c.column === 1);
    if (cell !== undefined) {
      cell.type = 'formula';
      cell.formula = '=A1*2';
      cell.cachedValue = '42';
    }
    expect(normalizeTable(formula, EMPTY_PLAN).rows[0]?.values['revenue']).toBeNull();
    const profile = profileTable(formula);
    const cacheId = profile.issues.find((q) => q.kind === 'formula-cache')?.id;
    expect(cacheId).toBeDefined();
    const opted = normalizeTable(formula, {
      ...EMPTY_PLAN,
      issueIds: [cacheId as string],
      columns: confirmedColumns(formula),
      useUnverifiedFormulaCaches: ['revenue'],
    });
    expect(opted.rows[0]?.values['revenue']).toBe('42');
  });

  it('keeps missing cells missing — never zero, never imputed', () => {
    const raw = rawTable(['score'], [[''], ['5']]);
    const table = normalizeTable(raw, EMPTY_PLAN);
    expect(table.rows[0]?.values['score']).toBeNull();
    expect(table.rows[1]?.values['score']).toBe('5');
    expect(profileTable(raw).issues.some((q) => q.kind === 'missing')).toBe(true);
  });
});

describe('helpers', () => {
  it('columnLetter, slugColumnId and significantDigitsOf follow their contracts', () => {
    expect([columnLetter(1), columnLetter(26), columnLetter(27), columnLetter(28)]).toEqual(['A', 'Z', 'AA', 'AB']);
    expect(slugColumnId('Target Revenue (USD)')).toBe('target_revenue_usd');
    expect(slugColumnId('   ')).toBe('column');
    expect(significantDigitsOf('881000.00')).toBe(8);
    expect(significantDigitsOf('0.001')).toBe(1);
  });
});
