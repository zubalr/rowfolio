/**
 * @rowfolio/ingest — safe workbook ingestion.
 *
 * UTF-8 CSV and unencrypted XLSX input only; everything else is a typed,
 * actionable failure. All bytes stay local (worker/browser memory). The
 * package exports exactly the contract surface — `parseSource` per
 * INTERFACES.md — plus `inspectSource` (bounded sheet listing/preview that
 * shares the same preflight), `handleIngestRequest` for the worker
 * supervisor, and `IngestError`/`toWorkerError` for typed failures.
 */

import type { RawTable } from '@rowfolio/contracts';
import { detectFormat } from './detect.ts';
import { IngestError } from './errors.ts';
import { resolveLimits } from './limits.ts';
import { checkAbort } from './abort.ts';
import { parseXlsx } from './xlsx.ts';
import { parseCsv } from './csv.ts';
import type { IngestExtras, ParseOptions, Progress } from './types.ts';

/** Raw source bytes; the contract transports them as ArrayBuffer. */
export type ParseInput = ArrayBuffer | Uint8Array;

const noopProgress: Progress = () => {};

/**
 * Contract `parseSource` (ParseSource signature) plus optional caller extras:
 * `signal` for cooperative cancellation, `delimiter` to resolve CSV
 * ambiguity, `limits` for tests. ParseOptions fields are the contract's.
 */
export async function parseSource(
  bytes: ParseInput,
  sourceName: string,
  options: ParseOptions,
  progress: Progress = noopProgress,
  extras: IngestExtras = {},
): Promise<RawTable> {
  const limits = resolveLimits(extras.limits);
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  checkAbort(extras.signal);
  if (input.byteLength === 0) {
    throw new IngestError('INVALID_FILE', { detail: 'empty-input' });
  }
  if (input.byteLength > limits.compressedBytes) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'input-bytes' });
  }

  const format = detectFormat(input);
  if (format === 'xlsx') {
    return parseXlsx(input, sourceName, options, extras, limits, progress);
  }
  return parseCsv(input, sourceName, options, extras, limits, progress);
}

export { inspectSource } from './inspect.ts';
export { handleIngestRequest } from './worker.ts';
export { IngestError, isIngestError, toWorkerError } from './errors.ts';
export type { IngestErrorCode, WorkerErrorCode } from './errors.ts';
export { detectFormat } from './detect.ts';
export { resolveLimits, defaultLimits } from './limits.ts';
export type { IngestLimits } from './limits.ts';
export type {
  SourceFormat,
  SheetInfo,
  SheetVisibility,
  SourceInspection,
  IngestExtras,
} from './types.ts';
export { WARNINGS } from './types.ts';
