/**
 * Shared helpers for the ingest suite: fixture bytes from disk, a progress
 * recorder that asserts contract semantics (stages, monotonic fractions),
 * and typed-failure assertions.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { IngestError } from '../../../packages/ingest/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const INGEST_FIXTURES = join(HERE, '..', '..', '..', 'fixtures', 'ingest', 'generated');
export const SAMPLE_FIXTURES = join(HERE, '..', '..', '..', 'fixtures', 'sample');
export const GOLDEN_FIXTURES = join(HERE, '..', '..', '..', 'fixtures', 'golden');

export function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(INGEST_FIXTURES, name)));
}

export function sampleBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(SAMPLE_FIXTURES, name)));
}

export function fixtureJson<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
}

export function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export interface ProgressEvent {
  stage: string;
  fraction: number | null;
}

/** Records progress events and exposes per-stage monotonicity checks. */
export function progressRecorder(): { fn: (stage: string, fraction: number | null) => void; events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  return {
    events,
    fn: (stage, fraction) => {
      const last = [...events].reverse().find((e) => e.stage === stage);
      if (last && last.fraction !== null && fraction !== null) {
        expect(fraction).toBeGreaterThanOrEqual(last.fraction);
      }
      if (fraction !== null) {
        expect(fraction).toBeGreaterThanOrEqual(0);
        expect(fraction).toBeLessThanOrEqual(1);
      }
      events.push({ stage, fraction });
    },
  };
}

/** Assert a promise rejects with an IngestError carrying the expected code/detail. */
export async function expectIngestError(
  promise: Promise<unknown>,
  code: string,
  detail?: string,
): Promise<IngestError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(IngestError);
    const e = err as IngestError;
    expect(e.code).toBe(code);
    if (detail !== undefined) expect(e.detail).toBe(detail);
    return e;
  }
  throw new Error(`expected IngestError ${code}${detail ? `:${detail}` : ''}, but resolved`);
}
