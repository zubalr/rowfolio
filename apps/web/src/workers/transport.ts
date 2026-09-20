import {
  checkWorkerEnvelope,
  checkWorkerRequest,
  checkWorkerResponse,
  classifyWorkerResponse,
  packEnvelope,
  type BinarySlot,
  type ContractIssue,
  type MessageContext,
  type WorkerEnvelope,
  type WorkerRequest,
  type WorkerResponse,
} from '@rowfolio/contracts';

export type { BinarySlot, ContractIssue, MessageContext, WorkerEnvelope, WorkerRequest, WorkerResponse };

export type ResponseFreshness = 'current' | 'stale' | 'invalid';

/** Minimal worker surface (structural twin of `Worker`). */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string; filename?: string; lineno?: number }) => void) | null;
}

export type WorkerFactory = () => WorkerLike;

/** Validate an incoming raw postMessage payload against the wire envelope schema. */
export function decodeEnvelope(data: unknown): { envelope: WorkerEnvelope | null; issues: ContractIssue[] } {
  const issues = checkWorkerEnvelope(data);
  if (issues.length > 0) return { envelope: null, issues };
  return { envelope: data as WorkerEnvelope, issues };
}

/** Encode a request into an envelope + transferable list. Throws ContractError on invalid payloads. */
export function encodeRequest(
  request: WorkerRequest,
  binaries: readonly BinarySlot[] = [],
): { envelope: WorkerEnvelope; transfer: ArrayBuffer[] } {
  return packEnvelope(request, binaries);
}

/** Encode a worker-side response into an envelope + transferable list. */
export function encodeResponse(
  response: WorkerResponse,
  binaries: readonly BinarySlot[] = [],
): { envelope: WorkerEnvelope; transfer: ArrayBuffer[] } {
  return packEnvelope(response, binaries);
}

/** Structural check on a request message (schema). Returns issues list. */
export function requestIssues(request: unknown): ContractIssue[] {
  return checkWorkerRequest(request);
}

/** Structural check on a response message (schema). Returns issues list. */
export function responseIssues(response: unknown): ContractIssue[] {
  return checkWorkerResponse(response);
}

/** Classify an already-validated response message against the live request guard. */
export function classify(message: WorkerResponse, expected: MessageContext): ResponseFreshness {
  return classifyWorkerResponse(message, expected);
}
