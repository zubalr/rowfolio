/**
 * Adversarial resource-amplification suite.
 *
 * The policy envelope counts *non-empty* cells — a sparse file is legal
 * input. Beyond the selected-range bound the parser refuses with a typed
 * LIMIT_EXCEEDED rather than materializing millions of objects; inside the
 * bound, blank fields never materialize and the profile/normalize pass runs
 * in the worker, off the main thread.
 */
import { describe, expect, it } from 'vitest';
import { parseSource } from '../../packages/ingest/src/index.ts';
import { profileTable } from '../../packages/normalize/src/index.ts';
import { csvBytes, csvGrid, toArrayBuffer } from './helpers.ts';

const OPTS = { allowHiddenSheet: false };

describe('sparse-file amplification', () => {
  it(
    'an over-envelope sparse CSV is refused as a typed LIMIT_EXCEEDED, never amplified',
    async () => {
      // 20k×100 = 2M range positions > nonemptyCells policy: the parser
      // refuses up front instead of materializing millions of objects.
      const csv = csvBytes(csvGrid(20_000, 100, (_r, c) => (c === 0 ? 'key' : '')));
      await expect(parseSource(toArrayBuffer(csv), 'sparse.csv', OPTS, () => {})).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      });
    },
    120_000,
  );

  it('a within-limits sparse CSV emits no blank-cell objects and bounded issues', async () => {
    // 2k×100 = 200k positions ≤ nonemptyCells: blank fields must not
    // materialize RawCell objects at all (absent ≡ blank for consumers).
    const csv = csvBytes(csvGrid(2_000, 100, (r, c) => (c === 0 ? `key${r}` : '')));
    const table = await parseSource(toArrayBuffer(csv), 'sparse-ok.csv', OPTS, () => {});
    expect(table.cells.every((c) => c.type !== 'blank' || c.row === table.sourceRef.headerRow)).toBe(true);
    expect(table.cells.length).toBeLessThanOrEqual(10_000);
    const profile = profileTable(table);
    expect(profile.issues.length).toBeLessThanOrEqual(210_000);
  });

  it('a dense 1k×100 CSV stays fast (control case)', async () => {
    const csv = csvBytes(csvGrid(1000, 100, (r, c) => `v${r}_${c}`));
    const t0 = performance.now();
    const table = await parseSource(toArrayBuffer(csv), 'dense.csv', OPTS, () => {});
    const ms = performance.now() - t0;
    expect(table.cells.length).toBe(100_100); // 1000 data rows × 100 + 100 headers
    expect(ms).toBeLessThan(30_000);
    const p = profileTable(table);
    expect(p.issues.length).toBeLessThanOrEqual(table.cells.length);
  });

  it('ragged rows (missing trailing fields) do not emit blank cells beyond declared width', async () => {
    const csv = csvBytes('a,b,c\n1,2\n3,4,5\n');
    const table = await parseSource(toArrayBuffer(csv), 'rag.csv', OPTS, () => {});
    // Row 2 lacks field 3 → nothing emitted at (3,3) — absent ≠ blank.
    expect(table.cells.find((c) => c.row === 2 && c.column === 3)).toBeUndefined();
    expect(table.warnings).toContain('ingest.warn.csv-ragged-rows');
  });
});
