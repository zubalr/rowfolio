/**
 * Worker transport envelopes — pack/classify/progress guards.
 * Binary buffers travel out-of-band only; the JSON message declares slots.
 */
import { describe, expect, it } from 'vitest';
import {
  checkWorkerEnvelope,
  classifyWorkerResponse,
  createProgressChecker,
  packEnvelope,
  ContractError,
  WORKER_REQUEST_EXAMPLE,
} from '../../packages/contracts/src/index.ts';
import { fixtureBytes } from './helpers.ts';

const SOURCE_BYTES = fixtureBytes('sample_operations.xlsx');

function ingestRequest(byteLength: number) {
  return {
    ...WORKER_REQUEST_EXAMPLE,
    payload: { sourceName: 'sample_operations.xlsx', format: 'xlsx', byteLength, binarySlot: 'source' },
  } as typeof WORKER_REQUEST_EXAMPLE;
}

describe('packEnvelope', () => {
  it('packs an ingest request with its source slot and returns the transfer list', () => {
    const buf = new ArrayBuffer(SOURCE_BYTES.byteLength);
    new Uint8Array(buf).set(SOURCE_BYTES);
    const { envelope, transfer } = packEnvelope(ingestRequest(SOURCE_BYTES.byteLength), [{ slot: 'source', buffer: buf }]);
    expect(envelope.binaries).toHaveLength(1);
    expect(transfer).toHaveLength(1);
    expect(transfer[0]!.byteLength).toBe(SOURCE_BYTES.byteLength);
  });

  it('throws ContractError when the declared slot is absent', () => {
    expect(() => packEnvelope(ingestRequest(4), [])).toThrow(ContractError);
  });

  it('throws on undeclared extra slots', () => {
    expect(() =>
      packEnvelope(ingestRequest(4), [
        { slot: 'source', buffer: new ArrayBuffer(4) },
        { slot: 'extra', buffer: new ArrayBuffer(1) },
      ]),
    ).toThrow(ContractError);
  });
});

describe('checkWorkerEnvelope', () => {
  it('accepts a well-formed ingest envelope', () => {
    const issues = checkWorkerEnvelope({
      message: ingestRequest(4),
      binaries: [{ slot: 'source', buffer: new ArrayBuffer(4) }],
    });
    expect(issues).toEqual([]);
  });

  it('rejects duplicate slot names', () => {
    const issues = checkWorkerEnvelope({
      message: ingestRequest(4),
      binaries: [
        { slot: 'source', buffer: new ArrayBuffer(4) },
        { slot: 'source', buffer: new ArrayBuffer(4) },
      ],
    });
    expect(issues.map((i) => i.rule)).toContain('envelope.slot.unique');
  });

  it('rejects non-ArrayBuffer payloads — binary never rides inside JSON', () => {
    const issues = checkWorkerEnvelope({
      message: ingestRequest(4),
      binaries: [{ slot: 'source', buffer: 'QUJD' }],
    });
    expect(issues.map((i) => i.rule)).toContain('envelope.slot.buffer');
  });
});

describe('classifyWorkerResponse — request/session/revision guard', () => {
  const expected = { requestId: 'req-1', sessionId: 'session-synthetic', revision: 1 };
  const progress = { protocolVersion: 1, requestId: 'req-1', sessionId: 'session-synthetic', revision: 1, kind: 'progress', stage: 'parse', fraction: 0.5 };
  const success = {
    protocolVersion: 1,
    requestId: 'req-1',
    sessionId: 'session-synthetic',
    revision: 1,
    kind: 'success',
    result: { disposed: true },
  };

  it('echoing response is current', () => {
    expect(classifyWorkerResponse(progress, expected)).toBe('current');
    expect(classifyWorkerResponse(success, expected)).toBe('current');
  });

  it('any requestId/sessionId/revision drift is stale', () => {
    expect(classifyWorkerResponse({ ...progress, requestId: 'req-0' }, expected)).toBe('stale');
    expect(classifyWorkerResponse({ ...progress, sessionId: 'old' }, expected)).toBe('stale');
    expect(classifyWorkerResponse({ ...progress, revision: 0 }, expected)).toBe('stale');
  });

  it('structurally invalid or wrong-protocol responses are invalid', () => {
    expect(classifyWorkerResponse({ kind: 'progress' }, expected)).toBe('invalid');
    expect(classifyWorkerResponse({ ...progress, protocolVersion: 0 }, expected)).toBe('invalid');
    expect(classifyWorkerResponse(null, expected)).toBe('invalid');
  });

  it('error responses classify like any other kind', () => {
    const err = { protocolVersion: 1, requestId: 'req-1', sessionId: 'session-synthetic', revision: 1, kind: 'error', code: 'INVALID_FILE', messageKey: 'error.invalidFile', recoverable: false };
    expect(classifyWorkerResponse(err, expected)).toBe('current');
  });
});

describe('createProgressChecker', () => {
  it('fraction must be monotonic within a stage; stage transitions reset', () => {
    const check = createProgressChecker();
    expect(check('parse', 0.2)).toBeNull();
    expect(check('parse', 0.5)).toBeNull();
    expect(check('parse', null)).toBeNull();
    const regression = check('parse', 0.4);
    expect(regression?.rule).toBe('progress.monotonic');
    expect(check('normalize', 0.1)).toBeNull(); // stage transition resets the baseline
    expect(check('normalize', 0.05)?.rule).toBe('progress.monotonic'); // still monotonic within the new stage
  });
});
