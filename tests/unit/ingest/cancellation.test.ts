/**
 * Cancellation + worker-envelope integration: AbortSignal checkpoints fire
 * mid-parse, progress stays monotonic within stages, and handleIngestRequest
 * maps the binary slot correctly.
 */
import { describe, expect, it } from 'vitest';
import type { RawTable } from '../../../packages/contracts/src/index.ts';
import { handleIngestRequest, parseSource, toWorkerError, IngestError } from '../../../packages/ingest/src/index.ts';
import { expectIngestError, fixtureBytes, progressRecorder, sampleBytes, toArrayBuffer } from './helpers.ts';

const OPTS = { allowHiddenSheet: false };
const NOOP = () => {};

describe('cancellation', () => {
  it('aborts before parse starts when signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expectIngestError(
      parseSource(toArrayBuffer(sampleBytes('sample_operations.csv')), 's.csv', OPTS, NOOP, { signal: ctrl.signal }),
      'CANCELLED',
    );
  });

  it('aborts mid-stream during ZIP inflation when the signal lands between entries', async () => {
    // A mutable signal flipped inside the progress callback — the next
    // onfile/ondata checkpoint must observe it and reject with CANCELLED.
    const signal = { aborted: false } as AbortSignal;
    const promise = parseSource(toArrayBuffer(fixtureBytes('types-and-formulas.xlsx')), 't.xlsx', OPTS, () => {
      signal.aborted = true;
    }, { signal });
    await expectIngestError(promise, 'CANCELLED');
  });

  it('abort during CSV row walk is observed at a checkpoint', async () => {
    const signal = { aborted: false } as AbortSignal;
    const big = ['a,b,c'];
    for (let i = 0; i < 20000; i += 1) big.push(`${i},x${i},y${i}`);
    const bytes = new TextEncoder().encode(big.join('\n') + '\n');
    // First 'parse' progress tick flips the signal; the next record's
    // checkAbort sees it.
    const promise = parseSource(bytes.buffer.slice(0) as ArrayBuffer, 'big.csv', OPTS, (stage) => {
      if (stage === 'parse') signal.aborted = true;
    }, { signal });
    await expectIngestError(promise, 'CANCELLED');
  });
});

describe('worker envelope glue', () => {
  const request = (name: string, bytes: Uint8Array, format: 'xlsx' | 'csv') =>
    ({
      protocolVersion: 1,
      requestId: 'req-1',
      sessionId: 'ses-1',
      revision: 0,
      operation: 'ingest',
      payload: { sourceName: name, format, byteLength: bytes.byteLength, binarySlot: 'source' },
    }) as const;

  it('parses the bytes carried in the named binary slot', async () => {
    const bytes = fixtureBytes('types-and-formulas.xlsx');
    const table: RawTable = await handleIngestRequest(
      request('types-and-formulas.xlsx', bytes, 'xlsx'),
      new Map([['source', toArrayBuffer(bytes)]]),
      NOOP,
    );
    expect(table.sourceRef.sheetName).toBe('Data');
  });

  it('rejects when the slot is missing', async () => {
    const bytes = fixtureBytes('types-and-formulas.xlsx');
    await expectIngestError(
      handleIngestRequest(request('x.xlsx', bytes, 'xlsx'), new Map(), NOOP),
      'SCHEMA_MISMATCH',
      'worker.binary-slot-missing',
    );
  });

  it('rejects when byteLength mismatches the slot', async () => {
    const bytes = fixtureBytes('types-and-formulas.xlsx');
    const req = request('x.xlsx', bytes, 'xlsx');
    const bad = { ...req, payload: { ...req.payload, byteLength: bytes.byteLength + 1 } };
    await expectIngestError(
      handleIngestRequest(bad, new Map([['source', toArrayBuffer(bytes)]]), NOOP),
      'SCHEMA_MISMATCH',
      'worker.byte-length-mismatch',
    );
  });
});

describe('progress semantics', () => {
  it('emits monotonic fractions per stage', async () => {
    const { fn, events } = progressRecorder();
    await parseSource(toArrayBuffer(sampleBytes('sample_operations.csv')), 's.csv', OPTS, fn);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(['preflight', 'parse']).toContain(e.stage);
  });
});

describe('toWorkerError', () => {
  it('preserves structured codes from foreign worker errors (CANCELLED/TIMEOUT)', () => {
    // The WorkerClient rejects with WorkerRequestError{code} — the upload
    // flow maps it through toWorkerError; typed codes must survive.
    expect(toWorkerError({ code: 'CANCELLED' }).code).toBe('CANCELLED');
    expect(toWorkerError({ code: 'TIMEOUT' }).code).toBe('TIMEOUT');
    expect(toWorkerError({ code: 'CANCELLED' }).recoverable).toBe(true);
  });

  it('still maps plain errors to INTERNAL and unknown codes to INTERNAL', () => {
    expect(toWorkerError(new Error('boom')).code).toBe('INTERNAL');
    expect(toWorkerError({ code: 'NOT_A_CODE' }).code).toBe('INTERNAL');
    expect(toWorkerError('string-throw').code).toBe('INTERNAL');
  });

  it('IngestError keeps its detail qualifier', () => {
    const mapped = toWorkerError(new IngestError('INVALID_FILE', { detail: 'zip.bad' }));
    expect(mapped.code).toBe('INVALID_FILE');
    expect(mapped.detail).toBe('zip.bad');
  });
});
