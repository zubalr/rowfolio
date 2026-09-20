/**
 * Worker transport contract (INTERFACES.md §"Worker transport").
 *
 * The postMessage envelope is `{ message, binaries: Array<{slot, buffer}> }`;
 * the transferable list carries exactly those buffers. Binary data NEVER
 * rides inside the JSON message — no ArrayBuffer serialization, no base64.
 * Every message echoes protocolVersion/requestId/sessionId/revision; stale
 * responses are ignored after diagnostics.
 */
import type { ExportArtifact, WorkerRequest, WorkerResponse } from './types.ts';
import { checkSchema, CONTRACT_VERSION, PROTOCOL_VERSION } from './registry.ts';
import { ContractError, issue, type ContractIssue } from './errors.ts';

export interface BinarySlot {
  readonly slot: string;
  readonly buffer: ArrayBuffer;
}

export interface WorkerEnvelope {
  readonly message: WorkerRequest | WorkerResponse;
  readonly binaries: readonly BinarySlot[];
}

export interface MessageContext {
  readonly requestId: string;
  readonly sessionId: string;
  readonly revision: number;
}

/** Structural + transport validation of a decoded worker envelope. */
export function checkWorkerEnvelope(envelope: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    return [issue('envelope', 'envelope.shape', '', 'envelope must be an object { message, binaries }')];
  }
  const env = envelope as Record<string, unknown>;
  const message = env['message'];
  const binaries = env['binaries'];

  // The message may be a request or a response — try both and report the better fit.
  const reqIssues = checkSchema('WorkerRequest', message);
  const resIssues = checkSchema('WorkerResponse', message);
  const messageIssues = reqIssues.length === 0 || resIssues.length === 0 ? [] : reqIssues.length <= resIssues.length ? reqIssues : resIssues;
  issues.push(...messageIssues.map((i) => ({ ...i, path: `/message${i.path}` })));

  if (!Array.isArray(binaries)) {
    issues.push(issue('envelope', 'envelope.binaries', '/binaries', 'binaries must be an array of { slot, buffer }'));
    return issues;
  }
  const slots = new Map<string, ArrayBuffer>();
  for (const [i, b] of binaries.entries()) {
    const p = `/binaries/${i}`;
    if (typeof b !== 'object' || b === null || Array.isArray(b)) {
      issues.push(issue('envelope', 'envelope.slot.shape', p, 'binary entry must be { slot, buffer }'));
      continue;
    }
    const { slot, buffer } = b as { slot?: unknown; buffer?: unknown };
    if (typeof slot !== 'string' || slot.length === 0) {
      issues.push(issue('envelope', 'envelope.slot.name', p, 'binary slot name must be a non-empty string'));
      continue;
    }
    if (slots.has(slot)) {
      issues.push(issue('envelope', 'envelope.slot.unique', p, `duplicate binary slot ${JSON.stringify(slot)}`));
    }
    if (!(buffer instanceof ArrayBuffer)) {
      issues.push(issue('envelope', 'envelope.slot.buffer', `${p}/buffer`, `slot ${JSON.stringify(slot)} buffer is not an ArrayBuffer — binary never travels inside JSON`));
    }
    slots.set(slot, buffer as ArrayBuffer);
  }

  // Required slot presence + exact byteLength, per operation/result.
  if (messageIssues.length === 0 && typeof message === 'object' && message !== null) {
    const m = message as Record<string, unknown>;
    const declared = declaredSlots(m);
    for (const d of declared) {
      const buf = slots.get(d.slot);
      if (buf === undefined) {
        issues.push(issue('envelope', 'envelope.slot.missing', `/message`, `declared binary slot ${JSON.stringify(d.slot)} is absent`));
      } else if (buf.byteLength !== d.byteLength) {
        issues.push(issue('envelope', 'envelope.slot.byteLength', `/message`, `slot ${JSON.stringify(d.slot)} declares ${d.byteLength} bytes but carries ${buf.byteLength}`));
      }
    }
    const declaredNames = new Set(declared.map((d) => d.slot));
    for (const slot of slots.keys()) {
      if (!declaredNames.has(slot)) {
        issues.push(issue('envelope', 'envelope.slot.unexpected', `/binaries`, `binary slot ${JSON.stringify(slot)} is not declared by the message`));
      }
    }
  }
  return issues;
}

function declaredSlots(message: Record<string, unknown>): { slot: string; byteLength: number }[] {
  const out: { slot: string; byteLength: number }[] = [];
  if (message['operation'] === 'ingest' && typeof message['payload'] === 'object' && message['payload'] !== null) {
    const p = message['payload'] as Record<string, unknown>;
    if (typeof p['binarySlot'] === 'string' && typeof p['byteLength'] === 'number') {
      out.push({ slot: p['binarySlot'], byteLength: p['byteLength'] });
    }
  }
  if (message['kind'] === 'success' && typeof message['result'] === 'object' && message['result'] !== null) {
    const r = message['result'] as Partial<ExportArtifact>;
    if (typeof r.binarySlot === 'string' && typeof r.byteLength === 'number') {
      out.push({ slot: r.binarySlot, byteLength: r.byteLength });
    }
  }
  return out;
}

/**
 * Pack a validated message + binary slots into a postMessage envelope and
 * transferable list. Throws ContractError when the envelope is invalid, so
 * malformed payloads never reach the wire.
 */
export function packEnvelope(message: WorkerRequest | WorkerResponse, binaries: readonly BinarySlot[]): { envelope: WorkerEnvelope; transfer: ArrayBuffer[] } {
  const envelope = { message, binaries };
  const issues = checkWorkerEnvelope(envelope);
  if (issues.length > 0) {
    throw new ContractError(issues);
  }
  return { envelope, transfer: binaries.map((b) => b.buffer) };
}

export type ResponseFreshness = 'current' | 'stale' | 'invalid';

/**
 * The request/session/revision guard: a response is 'current' only when it
 * echoes the in-flight protocol version and the expected
 * requestId/sessionId/revision exactly. Unknown or old messages must be
 * ignored by the UI (diagnostics carry no source values).
 */
export function classifyWorkerResponse(response: unknown, expected: MessageContext): ResponseFreshness {
  const structural = checkSchema('WorkerResponse', response);
  if (structural.length > 0) return 'invalid';
  const r = response as WorkerResponse;
  if (r.protocolVersion !== PROTOCOL_VERSION) return 'invalid';
  if (r.requestId !== expected.requestId || r.sessionId !== expected.sessionId || r.revision !== expected.revision) {
    return 'stale';
  }
  return 'current';
}

/**
 * Monotonic progress within a stage: fraction may be null (unknown work)
 * or nondecreasing while the stage stays the same; a stage transition
 * resets the baseline. Returns an issue on violation, null when fine.
 */
export function createProgressChecker(): (stage: string, fraction: number | null) => ContractIssue | null {
  let stage: string | null = null;
  let last = 0;
  return (nextStage: string, fraction: number | null): ContractIssue | null => {
    if (nextStage !== stage) {
      stage = nextStage;
      last = fraction ?? 0;
      return null;
    }
    if (fraction === null) return null;
    if (fraction < last) {
      return issue('envelope', 'progress.monotonic', '', `fraction ${fraction} regressed within stage ${JSON.stringify(stage)} (was ${last})`);
    }
    last = fraction;
    return null;
  };
}

/** Schema-version guard for persisted/normalized payloads crossing sessions. */
export function checkContractVersion(payload: { schemaVersion?: string }, path = ''): ContractIssue[] {
  if (payload.schemaVersion !== undefined && payload.schemaVersion !== CONTRACT_VERSION) {
    return [issue('version', 'schemaVersion', `${path}/schemaVersion`, `payload version ${JSON.stringify(payload.schemaVersion)} ≠ contract ${CONTRACT_VERSION}`)];
  }
  return [];
}
