/**
 * Shared builders for the Adversarial suite.
 *
 * Everything here is synthetic — no private or business data. Generators
 * reuse the checked-in ingest fixture kits (fixtures/ingest/*.mjs) so the
 * same primitives produce both positive and hostile fixtures.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import type { RawCell, RawTable } from '../../packages/contracts/src/index.ts';
import { buildZip } from '../../fixtures/ingest/zipkit.mjs';
import { buildXlsx } from '../../fixtures/ingest/xlsxkit.mjs';

export { buildZip, buildXlsx };

const HERE = dirname(fileURLToPath(import.meta.url));
export const ADV_DIR = HERE;
export const INGEST_FIXTURES = join(HERE, '..', '..', 'fixtures', 'ingest', 'generated');
export const HOSTILE_GENERATED = join(HERE, '..', '..', 'fixtures', 'hostile', 'generated');

export function bytesOf(dir: string, name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(dir, name)));
}

export function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export const NOOP = () => {};

/** utf-8 CSV bytes. */
export function csvBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A CSV with `cols` fields per row; `fill` decides each data cell's text. */
export function csvGrid(rows: number, cols: number, fill: (r: number, c: number) => string): string {
  const head = Array.from({ length: cols }, (_, c) => `h${c + 1}`).join(',');
  const lines = [head];
  for (let r = 0; r < rows; r += 1) {
    const fields: string[] = [];
    for (let c = 0; c < cols; c += 1) fields.push(fill(r, c));
    lines.push(fields.join(','));
  }
  return lines.join('\n') + '\n';
}

let rawSeq = 0;

/** Minimal contract-valid RawTable for normalize/analysis attacks. */
export function rawTable(
  headers: string[],
  rows: (string | null)[][],
  opts?: { types?: RawCell['type'][]; cachedValues?: (string | null)[][] },
): RawTable {
  rawSeq += 1;
  const cells: RawCell[] = [];
  headers.forEach((h, c) => {
    cells.push({ row: 1, column: c + 1, raw: h, type: 'text', formula: null, cachedValue: null });
  });
  rows.forEach((values, r) => {
    values.forEach((value, c) => {
      const cached = opts?.cachedValues?.[r]?.[c] ?? null;
      const type = opts?.types?.[c] ?? 'text';
      cells.push({
        row: r + 2,
        column: c + 1,
        raw: type === 'formula' ? (value ?? '=1') : value,
        type,
        formula: type === 'formula' ? (value ?? '=1') : null,
        cachedValue: cached,
      });
    });
  });
  return {
    id: `adv-raw-${rawSeq}`,
    sourceRef: {
      id: 'adv-source',
      sourceHash: 'a'.repeat(64),
      workbookName: 'attack.csv',
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

/** wall-clock ms for an awaitable thunk. */
export async function timed<T>(fn: () => Promise<T> | T): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
}

/**
 * Detach an ArrayBuffer exactly as a structured-clone transfer does
 * (what a real `worker.postMessage(msg, [buffer])` does to `buffer`).
 */
export function detachBuffer(buffer: ArrayBuffer): void {
  const channel = new MessageChannel();
  channel.port1.postMessage(buffer, [buffer]);
  channel.port1.close();
  channel.port2.close();
}
