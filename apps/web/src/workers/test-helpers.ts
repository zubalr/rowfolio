/**
 * Test-only worker harness — bridges WorkerClient to an in-process
 * WorkerSupervisor. NOT a production path: tests inject real ingest plus
 * contract-fixture adapters (the checked-in golden payloads) so the full
 * wire protocol is exercised without a DOM or a Worker.
 */
import { WorkerSupervisor, type SupervisorHooks } from './supervisor.ts';
import type { WorkerLike } from './transport.ts';
import type { WorkerRequest, WorkerResponse } from '@rowfolio/contracts';

export interface PostedMessage {
  message: WorkerResponse;
  binaries: readonly { slot: string; buffer: ArrayBuffer }[];
}

export class InProcessWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminated = false;
  /** Requests the worker received (for assertions). */
  readonly received: WorkerRequest[] = [];
  private readonly supervisor: WorkerSupervisor;

  constructor(hooks: SupervisorHooks = {}) {
    this.supervisor = new WorkerSupervisor(
      (message) => {
        const msg = message as { message: WorkerResponse; binaries: { slot: string; buffer: ArrayBuffer }[] };
        queueMicrotask(() => this.onmessage?.({ data: { message: msg.message, binaries: msg.binaries } }));
      },
      hooks,
    );
  }

  postMessage(message: unknown): void {
    if (this.terminated) return;
    const env = message as { message: WorkerRequest };
    this.received.push(env.message);
    queueMicrotask(() => {
      if (!this.terminated) void this.supervisor.handleMessage(message);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** Worker factory that yields a fresh InProcessWorker per spawn. */
export function inProcessFactory(
  hooks: SupervisorHooks = {},
  onSpawn?: (worker: InProcessWorker) => void,
): () => WorkerLike {
  return () => {
    const w = new InProcessWorker(hooks);
    onSpawn?.(w);
    return w;
  };
}
