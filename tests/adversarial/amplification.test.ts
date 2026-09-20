/**
 * A22 adversarial resource-amplification suite.
 *
 * The 50k×100 policy envelope counts *non-empty* cells — a sparse file is
 * legal input. This suite measures how RawCell/issue objects scale against
 * a legal-but-sparse CSV and asserts the pipeline stays bounded (the
 * downstream profile/normalize pass runs on the MAIN thread in the upload
 * flow — unbounded amplification there freezes the tab).
 *
 * `it.fails` = demonstrated defect: the assertion encodes a safe bound.
 */
import { describe, expect, it } from 'vitest';
import { parseSource } from '../../packages/ingest/src/index.ts';
import { profileTable } from '../../packages/normalize/src/index.ts';
import { csvBytes, csvGrid, toArrayBuffer } from './helpers.ts';

const OPTS = { allowHiddenSheet: false };

interface Metrics {
  fileBytes: number;
  parseMs: number;
  cells: number;
  profileMs: number;
  issues: number;
  rssDeltaMB: number;
}

async function measureSparse(rows: number, cols: number): Promise<Metrics> {
  // One nonempty cell per row keeps the record alive under Papa's greedy
  // skip; the other 99 fields are empty → a blank RawCell per field.
  const csv = csvBytes(csvGrid(rows, cols, (_r, c) => (c === 0 ? 'key' : '')));
  globalThis.gc?.();
  const rss0 = process.memoryUsage().rss;
  const t0 = performance.now();
  const table = await parseSource(toArrayBuffer(csv), 'sparse.csv', OPTS, () => {});
  const parseMs = performance.now() - t0;
  const t1 = performance.now();
  const profile = profileTable(table);
  const profileMs = performance.now() - t1;
  const rssDeltaMB = (process.memoryUsage().rss - rss0) / (1024 * 1024);
  return {
    fileBytes: csv.byteLength,
    parseMs,
    cells: table.cells.length,
    profileMs,
    issues: profile.issues.length,
    rssDeltaMB,
  };
}

describe('sparse-file amplification', () => {
  it.fails(
    'a within-limits 20k×100 near-empty CSV must not produce millions of blank cells/issues (A22-F05)',
    async () => {
      const m = await measureSparse(20_000, 100);
      console.log(
        `[A22-F05] ${m.fileBytes} B → ${m.cells} cells, ${m.issues} issues; ` +
          `parse ${m.parseMs.toFixed(0)}ms, profile ${m.profileMs.toFixed(0)}ms, +${m.rssDeltaMB.toFixed(0)}MB RSS`,
      );
      // Safe bound: issues should be deduplicated/capped (summary-level), and
      // blank cells shouldn't materialize at all for empty fields. Today the
      // CSV emitter creates a RawCell per empty field AND the profiler emits
      // one issue per missing cell: ~rows×cols objects ≈ 2M each side → the
      // main-thread profile pass alone takes seconds-to-minutes and gigabytes.
      expect(m.issues).toBeLessThanOrEqual(m.fileBytes / 4);
      expect(m.cells).toBeLessThanOrEqual(500_000);
    },
    120_000,
  );

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
