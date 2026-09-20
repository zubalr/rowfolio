/**
 * Worker-facing glue: maps the contract's ingest `WorkerRequest` payload
 * (bytes live in a named binary slot, never inline) to the adapters.
 *
 * NOTE: the v1.0.0 ingest payload carries only {sourceName, format,
 * byteLength, binarySlot} — no ParseOptions. `handleIngestRequest` therefore
 * parses the default sheet/range unless the supervisor passes `options`
 * (forwarded to the adapters unchanged). The supervisor owns the watchdog
 * timer and maps thrown values through `toWorkerError`.
 */
import type { RawTable, WorkerRequest } from '@rowfolio/contracts';
import { checkWorkerRequest } from '@rowfolio/contracts';
import { detectFormat } from './detect.ts';
import { IngestError } from './errors.ts';
import { resolveLimits } from './limits.ts';
import { checkAbort } from './abort.ts';
import { parseXlsx } from './xlsx.ts';
import { parseCsv } from './csv.ts';
import type { BinarySlots, IngestExtras, ParseOptions, Progress } from './types.ts';

type IngestRequest = Extract<WorkerRequest, { operation: 'ingest' }>;

export async function handleIngestRequest(
  request: IngestRequest,
  slots: BinarySlots,
  progress: Progress,
  options?: Partial<ParseOptions> & IngestExtras,
): Promise<RawTable> {
  if (checkWorkerRequest(request).length > 0 || request.operation !== 'ingest') {
    throw new IngestError('SCHEMA_MISMATCH', { detail: 'worker.request-invalid' });
  }
  const { sourceName, byteLength, binarySlot } = request.payload;
  const bytes = slots.get(binarySlot);
  if (!bytes) {
    throw new IngestError('SCHEMA_MISMATCH', { detail: 'worker.binary-slot-missing' });
  }
  if (bytes.byteLength !== byteLength) {
    throw new IngestError('SCHEMA_MISMATCH', { detail: 'worker.byte-length-mismatch' });
  }

  const limits = resolveLimits(options?.limits);
  const input = new Uint8Array(bytes);
  const parseOptions: ParseOptions = {
    allowHiddenSheet: options?.allowHiddenSheet ?? false,
    ...(options?.headerRow !== undefined ? { headerRow: options.headerRow } : {}),
    ...(options?.firstColumn !== undefined ? { firstColumn: options.firstColumn } : {}),
    ...(options?.lastColumn !== undefined ? { lastColumn: options.lastColumn } : {}),
    ...(options?.selectedSheetId !== undefined ? { selectedSheetId: options.selectedSheetId } : {}),
  };
  const extras: IngestExtras = {
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
    ...(options?.delimiter !== undefined ? { delimiter: options.delimiter } : {}),
    ...(options?.limits !== undefined ? { limits: options.limits } : {}),
  };

  checkAbort(extras.signal);
  if (input.byteLength === 0) {
    throw new IngestError('INVALID_FILE', { detail: 'empty-input' });
  }
  if (input.byteLength > limits.compressedBytes) {
    throw new IngestError('LIMIT_EXCEEDED', { detail: 'input-bytes' });
  }
  const format = detectFormat(input);
  if (format === 'xlsx') {
    return parseXlsx(input, sourceName, parseOptions, extras, limits, progress);
  }
  return parseCsv(input, sourceName, parseOptions, extras, limits, progress);
}
