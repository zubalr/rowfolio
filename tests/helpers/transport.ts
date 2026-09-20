/**
 * Worker-envelope test helpers with dual-oracle assertions: the contract
 * validators in packages/contracts (wire authority) are cross-checked
 * against the independent implementations in tooling/test — a regression
 * in either surfaces as a disagreement, not a silent pass.
 */
import {
  checkWorkerEnvelope,
  checkWorkerResponse,
  classifyWorkerResponse,
  createProgressChecker,
  PROTOCOL_VERSION,
  type MessageContext,
  type ResponseFreshness,
  type WorkerResponse,
} from '../../packages/contracts/src/index.ts';
import {
  classifyResponse as independentClassify,
  envelopeIssues as independentEnvelopeIssues,
  progressSequenceIssues as independentProgressIssues,
  responseShapeIssues as independentShapeIssues,
} from '../../tooling/test/envelope.ts';

export const DEFAULT_GUARD: MessageContext = { requestId: 'req-test', sessionId: 'sess-test', revision: 0 };

export function guard(over: Partial<MessageContext> = {}): MessageContext {
  return { ...DEFAULT_GUARD, ...over };
}

export const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

export function buildProgress(over: Record<string, unknown> = {}): WorkerResponse {
  return json({
    kind: 'progress',
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-test',
    sessionId: 'sess-test',
    revision: 0,
    stage: 'parse',
    fraction: 0.1,
    ...over,
  }) as WorkerResponse;
}

export function buildSuccess(over: Record<string, unknown> = {}): WorkerResponse {
  return json({
    kind: 'success',
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-test',
    sessionId: 'sess-test',
    revision: 0,
    result: { disposed: true },
    ...over,
  }) as WorkerResponse;
}

export function buildError(over: Record<string, unknown> = {}): WorkerResponse {
  return json({
    kind: 'error',
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-test',
    sessionId: 'sess-test',
    revision: 0,
    code: 'INVALID_FILE',
    messageKey: 'error.invalidFile',
    recoverable: true,
    ...over,
  }) as WorkerResponse;
}

/** Errors when contract and independent classifiers disagree, or both ≠ expected. */
export function expectFreshnessAgree(
  label: string,
  rawResponse: unknown,
  ctx: MessageContext,
  expected: ResponseFreshness,
): void {
  const contractResult = classifyWorkerResponse(json(rawResponse), ctx);
  const independent = independentClassify(json(rawResponse), ctx);
  if (contractResult !== independent) {
    throw new Error(
      `${label}: classifier disagreement — contracts=${contractResult} independent=${independent}`,
    );
  }
  if (independent !== expected) {
    throw new Error(`${label}: expected ${expected}, both oracles reported ${independent}`);
  }
}

export function expectResponseShapeValid(label: string, rawResponse: unknown): void {
  const contractIssues = checkWorkerResponse(json(rawResponse));
  const independentIssues = independentShapeIssues(json(rawResponse));
  if (contractIssues.length > 0 || independentIssues.length > 0) {
    throw new Error(
      `${label}: expected valid response shape — ` +
        `contracts: ${contractIssues.map((i) => i.code).join(',') || 'ok'}; ` +
        `independent: ${independentIssues.join(',') || 'ok'}`,
    );
  }
}

/**
 * Envelope agreement: `expectedCodes` are contract-side issue codes; the
 * independent checker must agree on clean/dirty (its codes differ — it
 * reports `envelope.slot-*` for the same defects).
 */
export function expectEnvelopeAgree(
  label: string,
  envelope: unknown,
  expectedCodes: string[] = [],
): void {
  const contractCodes = checkWorkerEnvelope(envelope).map((i) => i.rule).sort();
  const independentCodes = independentEnvelopeIssues(envelope).map((f) => f.code);
  for (const code of expectedCodes) {
    if (!contractCodes.includes(code)) {
      throw new Error(`${label}: contract checker missed ${code} (got ${contractCodes.join(',') || 'none'})`);
    }
  }
  const independentDirty = independentCodes.some((c) => c !== 'envelope.ok');
  if (expectedCodes.length === 0 && independentDirty) {
    throw new Error(`${label}: contract clean but independent flagged ${independentCodes.join(',')}`);
  }
  if (expectedCodes.length > 0 && !independentDirty) {
    throw new Error(`${label}: contract flagged ${expectedCodes.join(',')} but independent saw nothing`);
  }
}

/** Build a contract-valid envelope: real ArrayBuffers paired to declared slots. */
export function makeEnvelope(
  message: Record<string, unknown>,
  slots: Record<string, Uint8Array> = {},
): { message: Record<string, unknown>; binaries: { slot: string; buffer: ArrayBuffer }[] } {
  return {
    message,
    binaries: Object.entries(slots).map(([slot, bytes]) => ({
      slot,
      buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    })),
  };
}

export { createProgressChecker, independentProgressIssues };
