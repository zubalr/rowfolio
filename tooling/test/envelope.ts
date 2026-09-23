/**
 * Independent worker-envelope guard checks (tooling/test).
 *
 * Re-implements the request/session/revision freshness rule and the
 * binary-slot rules from contracts/INTERFACES.md §"Worker transport"
 * WITHOUT importing packages/contracts — tests/helpers cross-checks this
 * implementation against the real validators so both stay honest.
 */
import { finding, type Finding } from './findings.ts';

export interface GuardContext {
  requestId: string;
  sessionId: string;
  revision: number;
}

export type Freshness = 'current' | 'stale' | 'invalid';

const KINDS = new Set(['progress', 'success', 'error']);
const STAGES = new Set(['preflight', 'parse', 'normalize', 'analyze', 'model', 'layout', 'charts', 'package']);
const ERROR_CODES = new Set([
  'INVALID_FILE',
  'LIMIT_EXCEEDED',
  'AMBIGUOUS_INPUT',
  'UNSUPPORTED',
  'CANCELLED',
  'TIMEOUT',
  'EXPORT_FAILED',
  'SCHEMA_MISMATCH',
  'INTERNAL',
]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural shape of a WorkerResponse, per the wire schema. */
export function responseShapeIssues(msg: unknown): string[] {
  const problems: string[] = [];
  if (!isObj(msg)) return ['not an object'];
  if (msg['protocolVersion'] !== 1) problems.push('protocolVersion !== 1');
  for (const f of ['requestId', 'sessionId'] as const) {
    if (typeof msg[f] !== 'string' || (msg[f] as string).length === 0) problems.push(`${f} missing/empty`);
  }
  const rev = msg['revision'];
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0) problems.push('revision not a nonnegative integer');
  const kind = msg['kind'];
  if (typeof kind !== 'string' || !KINDS.has(kind)) {
    problems.push('kind not in {progress, success, error}');
    return problems;
  }
  if (kind === 'progress') {
    if (typeof msg['stage'] !== 'string' || !STAGES.has(msg['stage'] as string)) problems.push('progress.stage unknown');
    const frac = msg['fraction'];
    if (frac !== null && (typeof frac !== 'number' || !(frac >= 0 && frac <= 1))) problems.push('progress.fraction out of [0,1]');
  } else if (kind === 'success') {
    if (!isObj(msg['result'])) problems.push('success.result missing/not an object');
  } else if (kind === 'error') {
    if (typeof msg['code'] !== 'string' || !ERROR_CODES.has(msg['code'] as string)) problems.push('error.code unknown');
    if (typeof msg['messageKey'] !== 'string' || (msg['messageKey'] as string).length === 0) problems.push('error.messageKey missing');
    if (typeof msg['recoverable'] !== 'boolean') problems.push('error.recoverable not boolean');
  }
  return problems;
}

/**
 * Freshness guard: 'current' only when the message is structurally valid
 * AND echoes the expected requestId/sessionId/revision exactly.
 */
export function classifyResponse(msg: unknown, expected: GuardContext): Freshness {
  if (responseShapeIssues(msg).length > 0) return 'invalid';
  const m = msg as { requestId: string; sessionId: string; revision: number };
  if (m.requestId !== expected.requestId || m.sessionId !== expected.sessionId || m.revision !== expected.revision) {
    return 'stale';
  }
  return 'current';
}

/**
 * Monotonic progress within a stage; a stage transition resets the
 * baseline and null fractions are always legal (unknown work).
 */
export function progressSequenceIssues(events: readonly { stage: string; fraction: number | null }[]): Finding[] {
  const findings: Finding[] = [];
  let stage: string | null = null;
  let last = 0;
  events.forEach((e, i) => {
    if (e.stage !== stage) {
      stage = e.stage;
      last = e.fraction ?? 0;
      return;
    }
    if (e.fraction === null) return;
    if (e.fraction < last) {
      findings.push(
        finding('progress.regression', 'error', `event ${i}: fraction ${e.fraction} regressed within stage ${stage} (was ${last})`),
      );
    }
    last = e.fraction;
  });
  return findings;
}

export interface BinarySlotMeta {
  slot: string;
  buffer: { byteLength: number };
}

/**
 * Envelope transport rules: { message, binaries } shape, unique slot
 * names, and — when the message declares a binarySlot + byteLength — the
 * buffer must exist and match exactly. No JSON-serialized binary allowed.
 */
export function envelopeIssues(envelope: unknown): Finding[] {
  const findings: Finding[] = [];
  if (!isObj(envelope)) return [finding('envelope.shape', 'error', 'envelope must be an object {message, binaries}')];
  const message = envelope['message'];
  const binaries = envelope['binaries'];
  if (!isObj(message)) findings.push(finding('envelope.message', 'error', 'message missing/not an object'));
  if (!Array.isArray(binaries)) {
    findings.push(finding('envelope.binaries', 'error', 'binaries missing/not an array'));
    return findings;
  }
  const seen = new Set<string>();
  const bySlot = new Map<string, number>();
  binaries.forEach((b, i) => {
    if (!isObj(b)) {
      findings.push(finding('envelope.slot-shape', 'error', `binaries[${i}] not an object`));
      return;
    }
    const slot = b['slot'];
    const buffer = b['buffer'];
    if (typeof slot !== 'string' || slot.length === 0) {
      findings.push(finding('envelope.slot-name', 'error', `binaries[${i}].slot missing`));
      return;
    }
    if (seen.has(slot)) {
      findings.push(finding('envelope.slot-duplicate', 'error', `duplicate binary slot ${JSON.stringify(slot)}`));
    }
    seen.add(slot);
    const len = isObj(buffer) && typeof buffer['byteLength'] === 'number' ? buffer['byteLength'] : null;
    if (len === null) {
      findings.push(finding('envelope.slot-buffer', 'error', `binaries[${i}].buffer has no byteLength (must be ArrayBuffer)`, slot));
    } else {
      bySlot.set(slot, len);
    }
  });
  if (isObj(message)) {
    const payload = isObj(message['payload']) ? (message['payload'] as Record<string, unknown>) : null;
    const result = isObj(message['result']) ? (message['result'] as Record<string, unknown>) : null;
    for (const carrier of [payload, result]) {
      if (!carrier) continue;
      const slotName = carrier['binarySlot'];
      const byteLength = carrier['byteLength'];
      if (slotName !== undefined) {
        if (typeof slotName !== 'string' || !bySlot.has(slotName)) {
          findings.push(finding('envelope.slot-missing', 'error', `declared binarySlot ${JSON.stringify(slotName)} not in binaries`));
        } else if (typeof byteLength === 'number' && bySlot.get(slotName) !== byteLength) {
          findings.push(
            finding(
              'envelope.slot-size',
              'error',
              `declared byteLength ${byteLength} != buffer ${bySlot.get(slotName)} for slot ${JSON.stringify(slotName)}`,
            ),
          );
        }
      }
    }
  }
  return findings;
}
