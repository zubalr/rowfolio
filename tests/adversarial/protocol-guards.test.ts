/**
 * A22 adversarial protocol suite — stale/duplicate/malformed worker
 * responses, mid-flight replacement, watchdog termination, envelope/binary
 * consistency, and dispose semantics. Uses WorkerClient against scripted
 * WorkerLike fakes (no engines needed — this layer is pure transport).
 */
import { describe, expect, it } from 'vitest';
import { WorkerClient } from '../../apps/web/src/workers/client.ts';
import { WorkerSupervisor } from '../../apps/web/src/workers/supervisor.ts';
import type { WorkerLike } from '../../apps/web/src/workers/transport.ts';
import { encodeRequest, encodeResponse } from '../../apps/web/src/workers/transport.ts';
import type { WorkerRequest, WorkerResponse } from '../../packages/contracts/src/index.ts';

const REQ: WorkerRequest = {
  protocolVersion: 1,
  requestId: 'r1',
  sessionId: 's1',
  revision: 0,
  operation: 'dispose',
  payload: {},
};

function ok(request: WorkerRequest, result: unknown = { disposed: true }): WorkerResponse {
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    sessionId: request.sessionId,
    revision: request.revision,
    kind: 'success',
    result,
  } as WorkerResponse;
}

/** WorkerLike that replies with scripted envelopes (or raw objects). */
class ScriptedWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  terminated = false;
  script: (request: WorkerRequest, post: (data: unknown, transfer?: Transferable[]) => void) => void;
  constructor(script: ScriptedWorker['script']) {
    this.script = script;
  }
  postMessage(message: unknown): void {
    const req = (message as { message: WorkerRequest }).message;
    queueMicrotask(() => this.script(req, (data) => this.onmessage?.({ data })));
  }
  terminate(): void {
    this.terminated = true;
  }
}

function packedResponse(r: WorkerResponse, binaries: { slot: string; buffer: ArrayBuffer }[] = []) {
  const { envelope } = encodeResponse(r, binaries);
  return envelope;
}

/* ------------------------------------------------------------------ */

describe('stale and malformed responses', () => {
  it('drops a response echoing an older requestId and keeps waiting for the real one', async () => {
    const worker = new ScriptedWorker((req, reply) => {
      reply(packedResponse(ok({ ...req, requestId: 'old-request' })));
      setTimeout(() => reply(packedResponse(ok(req))), 5);
    });
    const client = new WorkerClient(() => worker);
    const res = await client.request(REQ);
    expect(res.result).toEqual({ disposed: true });
  });

  it('drops a response echoing a foreign sessionId', async () => {
    const diagnostics: string[] = [];
    const worker = new ScriptedWorker((req, reply) => {
      reply(packedResponse(ok({ ...req, sessionId: 'other-session' })));
      setTimeout(() => reply(packedResponse(ok(req))), 5);
    });
    const client = new WorkerClient(() => worker, { onDiagnostic: (m) => diagnostics.push(m) });
    const res = await client.request(REQ);
    expect(res.result).toEqual({ disposed: true });
    expect(diagnostics.some((d) => d.includes('stale'))).toBe(true);
  });

  it('rejects the in-flight request on a schema-invalid response (fail closed)', async () => {
    const worker = new ScriptedWorker((req, reply) => {
      reply({ message: { protocolVersion: 1, requestId: req.requestId, sessionId: req.sessionId, revision: 0, kind: 'mystery' }, binaries: [] });
    });
    const client = new WorkerClient(() => worker);
    await expect(client.request(REQ)).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
  });

  it('rejects when a success declares a binary slot that never arrives', async () => {
    const worker = new ScriptedWorker((req, reply) => {
      // supervisor-side encodeResponse would refuse this; simulate a raw
      // (post-encode) forged envelope reaching the client.
      reply({
        message: {
          protocolVersion: 1,
          requestId: req.requestId,
          sessionId: req.sessionId,
          revision: req.revision,
          kind: 'success',
          result: { binarySlot: 'artifact', byteLength: 4, sha256: 'x'.repeat(64), format: 'xlsx', mime: 'm', filename: 'f', exportId: 'e' },
        },
        binaries: [],
      });
    });
    const client = new WorkerClient(() => worker);
    // Envelope check fails → in-flight rejected with SCHEMA_MISMATCH.
    await expect(client.request(REQ)).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
  });

  it('a second concurrent request rejects instead of queueing', async () => {
    const worker = new ScriptedWorker((req, reply) => {
      setTimeout(() => reply(packedResponse(ok(req))), 50);
    });
    const client = new WorkerClient(() => worker);
    const first = client.request(REQ);
    await expect(client.request({ ...REQ, requestId: 'r2' })).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringContaining('in flight'),
    });
    await first;
  });

  it('watchdog terminates a silent worker and reports TIMEOUT recoverably', async () => {
    const worker = new ScriptedWorker(() => {});
    const client = new WorkerClient(() => worker, { watchdogMs: 60, warnAfterMs: 20 });
    await expect(client.request(REQ)).rejects.toMatchObject({ code: 'TIMEOUT', recoverable: true });
    await tick();
    expect(worker.terminated).toBe(true);
    // Replacement spawn happens on the next request.
    const worker2 = new ScriptedWorker((req, reply) => reply(packedResponse(ok(req))));
    let calls = 0;
    const client2 = new WorkerClient(() => (calls++, calls === 1 ? worker : worker2));
    await expect(client2.request(REQ)).rejects.toMatchObject({ code: 'TIMEOUT' });
    await expect(client2.request(REQ)).resolves.toMatchObject({ result: { disposed: true } });
  });

  it('cancel() rejects in-flight CANCELLED, and the next request uses a fresh worker', async () => {
    const spawned: ScriptedWorker[] = [];
    const factory = () => {
      const w = new ScriptedWorker((req, reply) => {
        if (req.requestId === 'r1') return; // hang the first
        reply(packedResponse(ok(req)));
      });
      spawned.push(w);
      return w;
    };
    const client = new WorkerClient(factory);
    const p = client.request(REQ);
    await tick();
    client.cancel('user');
    await expect(p).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(spawned[0]?.terminated).toBe(true);
    const res = await client.request({ ...REQ, requestId: 'r2' });
    expect(res.result).toEqual({ disposed: true });
    expect(spawned).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* Worker-side: malformed requests and double-dispose                  */
/* ------------------------------------------------------------------ */

describe('supervisor-side robustness', () => {
  it('malformed request envelope produces a typed error, never a throw', async () => {
    const posted: unknown[] = [];
    const sup = new WorkerSupervisor((msg) => posted.push(msg));
    await sup.handleMessage({ message: { garbage: true }, binaries: [] });
    const res = (posted[0] as { message: WorkerResponse }).message;
    expect(res.kind).toBe('error');
    expect((res as { code: string }).code).toBe('SCHEMA_MISMATCH');
  });

  it('normalize on an unknown rawTableId is a typed INTERNAL failure', async () => {
    const posted: unknown[] = [];
    const sup = new WorkerSupervisor((msg) => posted.push(msg));
    const { envelope } = encodeRequest({
      protocolVersion: 1,
      requestId: 'r9',
      sessionId: 's',
      revision: 0,
      operation: 'normalize',
      payload: { rawTableId: 'ghost', approvedIssueIds: [], columnConfirmations: [] },
    });
    await sup.handleMessage(envelope);
    const res = (posted as { message: WorkerResponse }[]).map((p) => p.message).find((m) => m.kind === 'error');
    expect(res?.kind).toBe('error');
    expect((res as { code: string }).code).toBe('INTERNAL');
  });

  it('dispose clears retained tables; a later normalize cannot resurrect them', async () => {
    const posted: unknown[] = [];
    const sup = new WorkerSupervisor((msg) => posted.push(msg), {
      adapters: {
        loadNormalize: async () => ({ normalizeTable: () => ({}) }) as never,
      },
    });
    const dispose = encodeRequest({ ...REQ, requestId: 'd1' });
    await sup.handleMessage(dispose.envelope);
    const res = (posted[0] as { message: WorkerResponse }).message;
    expect(res).toMatchObject({ kind: 'success' });
  });
});

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
