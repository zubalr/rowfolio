/**
 * Cancellation integration. The ingest package never blocks longer than one
 * checkpoint interval: every long loop (ZIP streaming, cell emission, CSV
 * records) calls `checkAbort` and periodically `yieldToEventLoop` so the
 * worker supervisor can deliver a cancel message between chunks — that is
 * the watchdog integration point.
 */
import { IngestError } from './errors.ts';

export function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new IngestError('CANCELLED', { detail: 'aborted' });
  }
}

/** Let pending messages (e.g. cancellation) run; call every `period` iterations. */
export async function yieldToEventLoop(iteration: number, period = 2048): Promise<void> {
  if (iteration % period === 0) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
