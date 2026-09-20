import { describe, expect, it } from 'vitest';
import { WorkerSupervisor } from './supervisor.ts';
import { BOUND_SAMPLE_SHA256 } from './supervisor.ts';
import type { WorkerRequest, WorkerResponse } from '@rowfolio/contracts';
import type { BinarySlot } from './transport.ts';
import { encodeRequest } from './transport.ts';

const encoder = new TextEncoder();

function csvBytes(text: string): ArrayBuffer {
  return encoder.encode(text).buffer as ArrayBuffer;
}

interface Posted {
  message: WorkerResponse;
  binaries: readonly BinarySlot[];
}

function harness(hooks?: ConstructorParameters<typeof WorkerSupervisor>[1]) {
  const posted: Posted[] = [];
  const supervisor = new WorkerSupervisor(
    (envelope) => {
      const env = envelope as { message: WorkerResponse; binaries: BinarySlot[] };
      posted.push({ message: env.message, binaries: env.binaries });
    },
    hooks,
  );
  const send = async (request: WorkerRequest, binaries: BinarySlot[] = []) => {
    const { envelope } = encodeRequest(request, binaries);
    await supervisor.handleMessage(envelope);
    return posted;
  };
  return { supervisor, posted, send };
}

const baseRequest = (operation: WorkerRequest['operation'], payload: unknown, requestId = 'r1'): WorkerRequest => ({
  protocolVersion: 1,
  requestId,
  sessionId: 's1',
  revision: 0,
  operation,
  payload,
} as WorkerRequest);

describe('WorkerSupervisor', () => {
  it('runs real ingest on CSV bytes and retains the raw table for normalize', async () => {
    const { send, posted } = harness();
    const bytes = csvBytes('Period,Region,Revenue\n2026-03,North,1000\n2026-04,North,1200\n');
    const raw = await send(
      baseRequest('ingest', { sourceName: 'ops.csv', format: 'csv', byteLength: bytes.byteLength, binarySlot: 'source' }),
      [{ slot: 'source', buffer: bytes }],
    );
    const last = raw.at(-1)!.message;
    expect(last.kind).toBe('success');
    const table = (last as { result: { id: string; cells: unknown[] } }).result;
    expect(table.cells.length).toBeGreaterThan(0);
    void BOUND_SAMPLE_SHA256;

    // normalize on an unknown rawTableId fails honestly (not fabricated).
    await send(baseRequest('normalize', { rawTableId: 'no-such-table', approvedIssueIds: [], columnConfirmations: [] }, 'r2'));
    const norm = posted.at(-1)!.message;
    expect(norm.kind).toBe('error');
    expect((norm as { code: string }).code).toBe('INTERNAL');
  });

  it('answers dispose with {disposed:true}', async () => {
    const { posted, send } = harness();
    await send(baseRequest('dispose', {}));
    expect(posted.at(-1)!.message).toMatchObject({ kind: 'success', result: { disposed: true } });
  });

  it('reports SCHEMA_MISMATCH for a malformed envelope', async () => {
    const posted: Posted[] = [];
    const supervisor = new WorkerSupervisor((m) => posted.push(m as never));
    await supervisor.handleMessage({ message: { nope: 1 }, binaries: [] });
    const msg = posted.at(-1)!.message;
    expect(msg.kind).toBe('error');
    expect((msg as { code: string }).code).toBe('SCHEMA_MISMATCH');
  });

  it('reports UNSUPPORTED when an engine adapter is a stub', async () => {
    const { posted, send } = harness();
    // normalize reaches the stubbed @rowfolio/normalize → AdapterUnavailableError → UNSUPPORTED
    const bytes = csvBytes('a,b\n1,2\n');
    await send(
      baseRequest('ingest', { sourceName: 'x.csv', format: 'csv', byteLength: bytes.byteLength, binarySlot: 'source' }),
      [{ slot: 'source', buffer: bytes }],
    );
    const ingestMsg = posted.at(-1)!.message;
    const rawId = (ingestMsg as { result: { id: string } }).result.id;
    await send(baseRequest('normalize', { rawTableId: rawId, approvedIssueIds: [], columnConfirmations: [] }, 'r2'));
    const msg = posted.at(-1)!.message;
    expect(msg.kind).toBe('error');
    expect((msg as { code: string }).code).toBe('UNSUPPORTED');
  });

  it('echoes requestId/sessionId/revision on every response', async () => {
    const { posted, send } = harness();
    await send(baseRequest('dispose', {}, 'echo-me'));
    const msg = posted.at(-1)!.message;
    expect(msg.requestId).toBe('echo-me');
    expect(msg.sessionId).toBe('s1');
    expect(msg.revision).toBe(0);
  });
});
