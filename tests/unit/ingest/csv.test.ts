/**
 * CSV adapter: UTF-8-fatal decode, delimiter detection/ambiguity, quoted
 * newlines with physical line provenance, header-row selection, caps.
 */
import { describe, expect, it } from 'vitest';
import type { RawCell, RawTable } from '../../../packages/contracts/src/index.ts';
import { checkRawTable } from '../../../packages/contracts/src/index.ts';
import { inspectSource, parseSource } from '../../../packages/ingest/src/index.ts';
import { expectIngestError, fixtureBytes, toArrayBuffer } from './helpers.ts';

const OPTS = { allowHiddenSheet: false };
const NOOP = () => {};

const p = (name: string, options = OPTS, extras?: { delimiter?: ',' | '\t' | ';' }) =>
  parseSource(toArrayBuffer(fixtureBytes(name)), name, options, NOOP, extras);

function cellAt(table: RawTable, row: number, column: number): RawCell | undefined {
  return table.cells.find((c) => c.row === row && c.column === column);
}

describe('csv: basics', () => {
  it('parses comma CSV with physical line coordinates', async () => {
    const t = await p('leading-zeros.csv');
    expect(t.sourceRef.format).toBe('csv');
    expect(t.sourceRef.sheetId).toBe('S0');
    expect(t.dateSystem).toBe('not-applicable');
    expect(t.sourceRef.range).toEqual({ firstRow: 1, lastRow: 6, firstColumn: 1, lastColumn: 2 });
    expect(checkRawTable(t)).toEqual([]);
  });

  it('keeps identifier-looking text raw — no coercion', async () => {
    const t = await p('leading-zeros.csv');
    expect(cellAt(t, 2, 1)).toMatchObject({ raw: '007', type: 'text' });
    expect(cellAt(t, 3, 1)).toMatchObject({ raw: '01', type: 'text' });
    expect(cellAt(t, 4, 1)).toMatchObject({ raw: '+1', type: 'text' });
    expect(cellAt(t, 5, 1)).toMatchObject({ raw: '1e3', type: 'text' });
    expect(cellAt(t, 6, 1)).toMatchObject({ raw: '3.140', type: 'text' });
  });

  it('maps empty fields to blank cells and absent fields to nothing', async () => {
    const t = await p('ragged.csv');
    // row 4 has 4 fields — cells beyond the 3-col header range are truncated by range
    expect(t.sourceRef.range.lastColumn).toBe(4); // widest record wins
    expect(cellAt(t, 4, 4)?.raw).toBe('9');
    // row 3 is short — col 3 emits nothing (not blank): position absent
    expect(cellAt(t, 3, 3)).toBeUndefined();
    expect(t.warnings).toContain('ingest.warn.csv-ragged-rows');
    expect(t.warnings).toContain('ingest.warn.csv-blank-records-skipped');
  });

  it('skips blank physical lines but keeps coordinates honest', async () => {
    const t = await p('ragged.csv');
    // header at line 1; data at 2,3,4; blank 5,6; last record starts line 7
    const rows = [...new Set(t.cells.map((c) => c.row))].sort((a, b) => a - b);
    expect(rows).toEqual([1, 2, 3, 4, 7]);
    expect(t.sourceRef.range.lastRow).toBe(7);
  });
});

describe('csv: quoted newlines', () => {
  it('records spanning physical lines keep start-line coordinates', async () => {
    const t = await p('quoted-newlines.csv');
    // records: hdr L1, r1 L2-3, r2 L4, r3 L5, r4 L6
    const rows = [...new Set(t.cells.map((c) => c.row))].sort((a, b) => a - b);
    expect(rows).toEqual([1, 2, 4, 5, 6]);
    expect(t.sourceRef.range.lastRow).toBe(6);
    expect(cellAt(t, 2, 2)).toMatchObject({ raw: 'line one\nline two', type: 'text' });
    expect(cellAt(t, 4, 2)?.raw).toBe('comma, inside');
    expect(cellAt(t, 6, 2)?.raw).toBe('quote "inner"');
  });
});

describe('csv: delimiters', () => {
  it('detects consistent semicolon files', async () => {
    const t = await p('semicolon.csv');
    expect(cellAt(t, 2, 3)?.raw).toBe('3');
    expect(t.sourceRef.range.lastColumn).toBe(3);
  });

  it('throws AMBIGUOUS_INPUT when two delimiters are both consistent', async () => {
    await expectIngestError(p('ambiguous.csv'), 'AMBIGUOUS_INPUT', 'csv.ambiguous-delimiter');
  });

  it('accepts an explicit delimiter override for ambiguous files', async () => {
    const t = await p('ambiguous.csv', OPTS, { delimiter: ';' });
    expect(cellAt(t, 2, 1)?.raw).toBe('1,2');
    expect(cellAt(t, 2, 2)?.raw).toBe('3');
  });
});

describe('csv: encodings and edges', () => {
  it('rejects invalid UTF-8', async () => {
    await expectIngestError(p('invalid-utf8.csv'), 'INVALID_FILE', 'csv.invalid-utf8');
  });

  it('rejects empty input', async () => {
    await expectIngestError(p('empty.csv'), 'INVALID_FILE', 'empty-input');
  });

  it('rejects whitespace-only files', async () => {
    await expectIngestError(p('whitespace.csv'), 'INVALID_FILE', 'csv.empty');
  });

  it('strips a UTF-8 BOM', async () => {
    const t = await p('bom.csv');
    expect(cellAt(t, 1, 1)?.raw).toBe('a');
  });
});

describe('csv: header row selection', () => {
  it('defaults to the modal-width record, skipping narrow title lines', async () => {
    const t = await p('title-rows.csv');
    expect(t.sourceRef.headerRow).toBe(3);
    expect(cellAt(t, 3, 1)?.raw).toBe('id');
  });

  it('selects a physical line as header', async () => {
    const t = await p('title-rows.csv', { ...OPTS, headerRow: 3 });
    expect(t.sourceRef.headerRow).toBe(3);
    expect(t.sourceRef.range.firstRow).toBe(3);
    expect(cellAt(t, 3, 1)?.raw).toBe('id');
    expect(cellAt(t, 4, 2)?.raw).toBe('a');
  });

  it('rejects headerRow inside a multiline record', async () => {
    await expectIngestError(p('quoted-newlines.csv', { ...OPTS, headerRow: 3 }), 'INVALID_FILE', 'csv.header-row-inside-record');
  });
});

describe('csv: inspect', () => {
  it('reports a single visible sheet with line dimensions and preview', async () => {
    const insp = await inspectSource(toArrayBuffer(fixtureBytes('quoted-newlines.csv')), 'quoted-newlines.csv');
    expect(insp.format).toBe('csv');
    expect(insp.sheets).toHaveLength(1);
    expect(insp.sheets[0]?.dimensions).toEqual({ firstRow: 1, lastRow: 6, firstColumn: 1, lastColumn: 3 });
    expect(insp.previewRowNumbers).toContain(2);
    expect(insp.dateSystem).toBe('not-applicable');
  });
});
