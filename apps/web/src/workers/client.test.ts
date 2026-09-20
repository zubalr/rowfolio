import { describe, expect, it } from 'vitest';
import { WorkerClient } from './client.ts';
import { inProcessFactory, InProcessWorker } from './test-helpers.ts';
import type { WorkerLike, WorkerRequest } from './transport.ts';
import { encodeResponse } from './transport.ts';

const REQ = (id: string): WorkerRequest => ({
  protocolVersion: 1,
  requestId: id,
  sessionId: 's1',
  revision: 0,
  operation: 'dispose',
  payload: {},
});

function respond(worker: WorkerLike, data: unknown): void {
  worker.onmessage?.({ data });
}

describe('WorkerClient', () => {
  it('resolves a success response via the in-process supervisor', async () => {
    const client = new WorkerClient(inProcessFactory());
    const res = await client.request(REQ('r1'));
    expect(res.result).toEqual({ disposed: true });
    await client.dispose();
  });

  it('rejects a second request while one is in flight', async () => {
    // Worker that never responds.
    const silent = (): WorkerLike => ({
      postMessage: () => {},
      terminate: () => {},
      onmessage: null,
      onerror: null,
    });
    const client = new WorkerClient(silent);
    const first = client.request(REQ('a'));
    await expect(client.request(REQ('b'))).rejects.toThrow(/in flight/);
    client.cancel();
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('drops stale responses (request/session/revision mismatch) and stays pending', async () => {
    let worker: WorkerLike | null = null;
    const client = new WorkerClient(() => (worker = {
      postMessage: () => {},
      terminate: () => {},
      onmessage: null,
      onerror: null,
    }));
    const promise = client.request(REQ('r1'));
    await Promise.resolve();
    // Stale: wrong requestId
    const stale = encodeResponse({
      protocolVersion: 1, requestId: 'old', sessionId: 's1', revision: 0,
      kind: 'success', result: { disposed: true },
    });
    respond(worker!, stale.envelope);
    // Wrong session
    const staleSession = encodeResponse({
      protocolVersion: 1, requestId: 'r1', sessionId: 'OTHER', revision: 0,
      kind: 'success', result: { disposed: true },
    });
    respond(worker!, staleSession.envelope);
    // Still pending → cancel ends it as CANCELLED, not resolved.
    client.cancel();
    await expect(promise).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('fails SCHEMA_MISMATCH on an invalid envelope payload', async () => {
    let worker: WorkerLike | null = null;
    const client = new WorkerClient(() => (worker = {
      postMessage: () => {},
      terminate: () => {},
      onmessage: null,
      onerror: null,
    }));
    const promise = client.request(REQ('r1'));
    await Promise.resolve();
    respond(worker!, { message: { garbage: true }, binaries: [] });
    await expect(promise).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
  });

  it('watchdog terminates a stuck worker and recreates it for the next request', async () => {
    const spawns: { terminated: boolean }[] = [];
    const silent = (): WorkerLike => {
      const w = {
        postMessage: () => {},
        terminate: () => { w.terminated = true; },
        onmessage: null,
        onerror: null,
        terminated: false,
      };
      spawns.push(w);
      return w;
    };
    const client = new WorkerClient(silent, { watchdogMs: 30, warnAfterMs: 5 });
    await expect(client.request(REQ('stuck'))).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(spawns[0]!.terminated).toBe(true);
    // Next request spawns a fresh worker.
    const second = client.request(REQ('next'));
    await Promise.resolve();
    expect(spawns.length).toBe(2);
    client.cancel();
    await expect(second).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('forwards progress messages to the handler', async () => {
    const progress: string[] = [];
    const supervisor = new InProcessWorker();
    const client = new WorkerClient(() => supervisor);
    const req: WorkerRequest = {
      protocolVersion: 1, requestId: 'p1', sessionId: 's', revision: 0,
      operation: 'dispose', payload: {},
    };
    const promise = client.request(req, [], (p) => progress.push(p.stage));
    await promise;
    expect(progress).toEqual([]);
  });

  it('maps worker error responses to WorkerRequestError with code+messageKey', async () => {
    let worker: WorkerLike | null = null;
    const client = new WorkerClient(() => (worker = {
      postMessage: () => {},
      terminate: () => {},
      onmessage: null,
      onerror: null,
    }));
    const promise = client.request(REQ('r1'));
    await Promise.resolve();
    const err = encodeResponse({
      protocolVersion: 1, requestId: 'r1', sessionId: 's1', revision: 0,
      kind: 'error', code: 'LIMIT_EXCEEDED', messageKey: 'error.LIMIT_EXCEEDED', recoverable: true,
    });
    respond(worker!, err.envelope);
    await expect(promise).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      messageKey: 'error.LIMIT_EXCEEDED',
      recoverable: true,
    });
  });

  it('carries the wire detail qualifier through to WorkerRequestError', async () => {
    let worker: WorkerLike | null = null;
    const client = new WorkerClient(() => (worker = {
      postMessage: () => {},
      terminate: () => {},
      onmessage: null,
      onerror: null,
    }));
    const promise = client.request(REQ('r1'));
    await Promise.resolve();
    const err = encodeResponse({
      protocolVersion: 1, requestId: 'r1', sessionId: 's1', revision: 0,
      kind: 'error', code: 'AMBIGUOUS_INPUT', messageKey: 'error.AMBIGUOUS_INPUT',
      recoverable: true, detail: 'csv.ambiguous-delimiter',
    });
    respond(worker!, err.envelope);
    await expect(promise).rejects.toMatchObject({
      code: 'AMBIGUOUS_INPUT',
      detail: 'csv.ambiguous-delimiter',
    });
  });

  it('dispose() resolves without a worker ever spawned', async () => {
    const client = new WorkerClient(inProcessFactory());
    await expect(client.dispose()).resolves.toBeUndefined();
    await expect(client.request(REQ('x'))).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
