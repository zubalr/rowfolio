/**
 * Analysis worker entry — ingest/normalize/analyze/scenario/dispose.
 * Loaded as a module worker; Vite emits it as a separate chunk so the landing
 * entry stays free of parser/engine code.
 *
 * The v1 wire `ingest` payload cannot carry `ParseOptions` (sheet picker).
 * Parse options therefore arrive out of band via the Worker `name` channel:
 * `new Worker(url, { name: JSON.stringify({ parseOptions }) })`. This is a
 * documented v1 contract gap tracked in the PR body — the wire schema is
 * unchanged and the default path (no options) is unaffected.
 */
import { WorkerSupervisor } from './supervisor.ts';
import type { WorkerLike } from './transport.ts';

const scope = self as unknown as {
  postMessage: (message: unknown, transfer: Transferable[]) => void;
  onmessage: ((event: { data: unknown }) => void) | null;
  name?: string;
};

function readParseOptions(): Record<string, unknown> | null {
  try {
    const raw = scope.name;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { parseOptions?: Record<string, unknown> } | null;
    return parsed?.parseOptions ?? null;
  } catch {
    return null;
  }
}

const supervisor = new WorkerSupervisor(
  (message, transfer) => scope.postMessage(message, transfer),
  { readParseOptions },
);

scope.onmessage = (event: { data: unknown }) => {
  void supervisor.handleMessage(event.data);
};

export type { WorkerLike };
