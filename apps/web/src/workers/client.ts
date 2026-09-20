import { POLICY, type ContractIssue } from '@rowfolio/contracts';
import {
  classify,
  decodeEnvelope,
  encodeRequest,
  type BinarySlot,
  type MessageContext,
  type WorkerFactory,
  type WorkerLike,
  type WorkerRequest,
  type WorkerResponse,
} from './transport.ts';

export type WorkerErrorCode =
  | 'INVALID_FILE'
  | 'LIMIT_EXCEEDED'
  | 'AMBIGUOUS_INPUT'
  | 'UNSUPPORTED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'EXPORT_FAILED'
  | 'SCHEMA_MISMATCH'
  | 'INTERNAL';

/** Errors surfaced to the reducer. `messageKey` is an i18n catalog key (`error.*`). */
export class WorkerRequestError extends Error {
  readonly code: WorkerErrorCode;
  readonly messageKey: string;
  readonly recoverable: boolean;
  /** Content-free qualifier from the worker (e.g. `csv.ambiguous-delimiter`). */
  readonly detail: string | undefined;

  constructor(code: WorkerErrorCode, messageKey: string, recoverable: boolean, detail?: string) {
    super(detail ?? `${code} (${messageKey})`);
    this.name = 'WorkerRequestError';
    this.code = code;
    this.messageKey = messageKey;
    this.recoverable = recoverable;
    this.detail = detail;
  }

  static fromMessage(message: { code: string; messageKey: string; recoverable: boolean; detail?: string }): WorkerRequestError {
    const codes: WorkerErrorCode[] = [
      'INVALID_FILE', 'LIMIT_EXCEEDED', 'AMBIGUOUS_INPUT', 'UNSUPPORTED',
      'CANCELLED', 'TIMEOUT', 'EXPORT_FAILED', 'SCHEMA_MISMATCH', 'INTERNAL',
    ];
    const code = (codes as string[]).includes(message.code) ? (message.code as WorkerErrorCode) : 'INTERNAL';
    return new WorkerRequestError(code, message.messageKey || `error.${code}`, message.recoverable !== false, message.detail);
  }
}

export interface StageProgress {
  stage: string;
  fraction: number | null;
}

export type ProgressHandler = (progress: StageProgress) => void;
export type DiagnosticHandler = (diagnostic: string) => void;

export interface WorkerClientOptions {
  /** Hard cancel after this long without a terminal response. Defaults to POLICY.limits.watchdogMs. */
  watchdogMs?: number | undefined;
  /** Emit a warning diagnostic after this long. */
  warnAfterMs?: number | undefined;
  onWarn?: DiagnosticHandler | undefined;
  onDiagnostic?: DiagnosticHandler | undefined;
}

interface InFlight {
  context: MessageContext;
  onProgress: ProgressHandler | undefined;
  resolve: (value: { result: unknown; slots: Map<string, ArrayBuffer> }) => void;
  reject: (error: WorkerRequestError) => void;
  watchdog: ReturnType<typeof setTimeout> | null;
  warn: ReturnType<typeof setTimeout> | null;
}

const WARN_AFTER_MS = 5_000;
const DISPOSE_GRACE_MS = 50;

/**
 * Serializes requests over a dedicated worker. One in-flight request at a
 * time (the protocol's request/session/revision guard assumes it); a second
 * request while busy rejects — callers wanting interruption call `cancel()`,
 * which hard-terminates and lazily recreates the worker.
 */
export class WorkerClient {
  private worker: WorkerLike | null = null;
  private inFlight: InFlight | null = null;
  private terminated = false;

  constructor(
    private readonly factory: WorkerFactory,
    private readonly options: WorkerClientOptions = {},
  ) {}

  get busy(): boolean {
    return this.inFlight !== null;
  }

  /** Issue one request. Rejects (does not queue) if another request is in flight. */
  request(
    request: WorkerRequest,
    binaries: readonly BinarySlot[] = [],
    onProgress?: ProgressHandler,
  ): Promise<{ result: unknown; slots: Map<string, ArrayBuffer> }> {
    if (this.terminated) {
      return Promise.reject(new WorkerRequestError('INTERNAL', 'error.INTERNAL', false, 'client terminated'));
    }
    if (this.inFlight) {
      return Promise.reject(new WorkerRequestError('INTERNAL', 'error.INTERNAL', false, 'request already in flight'));
    }
    const context: MessageContext = {
      requestId: request.requestId,
      sessionId: request.sessionId,
      revision: request.revision,
    };

    let encoded: { envelope: { message: WorkerRequest | WorkerResponse; binaries: readonly BinarySlot[] }; transfer: ArrayBuffer[] };
    try {
      encoded = encodeRequest(request, binaries);
    } catch (error) {
      const issues = error instanceof Error ? error.message : String(error);
      return Promise.reject(new WorkerRequestError('SCHEMA_MISMATCH', 'error.SCHEMA_MISMATCH', false, issues));
    }

    return new Promise((resolve, reject) => {
      const inflight: InFlight = {
        context,
        onProgress,
        resolve,
        reject,
        watchdog: null,
        warn: null,
      };
      this.inFlight = inflight;

      let worker: WorkerLike;
      try {
        worker = this.ensureWorker();
      } catch (error) {
        this.inFlight = null;
        reject(new WorkerRequestError('INTERNAL', 'error.INTERNAL', false, String(error)));
        return;
      }

      const watchdogMs = this.options.watchdogMs ?? POLICY.limits.watchdogMs;
      inflight.warn = setTimeout(() => {
        this.options.onWarn?.(`request ${request.requestId} (${request.operation}) exceeded ${WARN_AFTER_MS}ms`);
      }, this.options.warnAfterMs ?? WARN_AFTER_MS);
      inflight.watchdog = setTimeout(() => {
        this.options.onDiagnostic?.(`watchdog: request ${request.requestId} (${request.operation}) timed out; terminating worker`);
        this.failInFlight(new WorkerRequestError('TIMEOUT', 'error.TIMEOUT', true, 'watchdog timeout'));
        this.recreateWorker();
      }, watchdogMs);

      try {
        worker.postMessage(encoded.envelope, encoded.transfer as Transferable[]);
      } catch (error) {
        this.failInFlight(new WorkerRequestError('INTERNAL', 'error.INTERNAL', false, String(error)));
      }
    });
  }

  /**
   * Hard-cancel the in-flight request: terminates the worker and lazily
   * recreates it on the next request. The in-flight promise rejects CANCELLED.
   */
  cancel(reason?: string): void {
    if (this.inFlight) {
      this.options.onDiagnostic?.(`cancel ${this.inFlight.context.requestId}${reason ? `: ${reason}` : ''}`);
      this.failInFlight(new WorkerRequestError('CANCELLED', 'error.CANCELLED', true, reason));
    }
    this.recreateWorker();
  }

  /** Best-effort dispose handshake, then terminate. Safe to call repeatedly. */
  async dispose(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    if (this.inFlight) {
      this.failInFlight(new WorkerRequestError('CANCELLED', 'error.CANCELLED', true, 'client disposed'));
    }
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      try {
        const dispose = encodeRequest({
          protocolVersion: 1,
          requestId: `dispose-${Date.now()}`,
          sessionId: 'disposed',
          revision: 0,
          operation: 'dispose',
          payload: {},
        });
        worker.postMessage(dispose.envelope, dispose.transfer as Transferable[]);
      } catch {
        // Terminate regardless — disposal must never fail loudly.
      }
      await new Promise((resolve) => setTimeout(resolve, DISPOSE_GRACE_MS));
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
  }

  private ensureWorker(): WorkerLike {
    if (!this.worker) {
      this.worker = this.factory();
      this.worker.onmessage = (event: { data: unknown }) => this.handleMessage(event.data);
      this.worker.onerror = (event: { message?: string }) => {
        this.options.onDiagnostic?.(`worker error: ${event.message ?? 'unknown'}`);
        this.failInFlight(new WorkerRequestError('INTERNAL', 'error.INTERNAL', false, event.message));
        this.recreateWorker();
      };
    }
    return this.worker;
  }

  private recreateWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
  }

  private failInFlight(error: WorkerRequestError): void {
    const inflight = this.inFlight;
    this.inFlight = null;
    if (inflight) {
      if (inflight.watchdog) clearTimeout(inflight.watchdog);
      if (inflight.warn) clearTimeout(inflight.warn);
      inflight.reject(error);
    }
  }

  private handleMessage(data: unknown): void {
    const inflight = this.inFlight;
    if (!inflight) {
      // Response with no in-flight request — unexpected; log for diagnostics only.
      this.options.onDiagnostic?.('received worker message with no in-flight request');
      return;
    }

    const { envelope, issues } = decodeEnvelope(data);
    if (!envelope) {
      this.options.onDiagnostic?.(`invalid envelope: ${formatIssues(issues)}`);
      // A malformed response for the in-flight request is terminal for it.
      this.failInFlight(new WorkerRequestError('SCHEMA_MISMATCH', 'error.SCHEMA_MISMATCH', false, formatIssues(issues)));
      return;
    }

    const freshness = classify(envelope.message as WorkerResponse, inflight.context);
    if (freshness === 'invalid') {
      this.options.onDiagnostic?.('invalid response payload (schema/protocol mismatch)');
      this.failInFlight(new WorkerRequestError('SCHEMA_MISMATCH', 'error.SCHEMA_MISMATCH', false, 'invalid response'));
      return;
    }
    if (freshness === 'stale') {
      // Stale message for an older request — drop silently, keep waiting.
      this.options.onDiagnostic?.('stale response dropped (request/session/revision mismatch)');
      return;
    }

    const message = envelope.message as WorkerResponse;
    if (message.kind === 'progress') {
      inflight.onProgress?.({ stage: message.stage, fraction: message.fraction });
      return;
    }
    if (message.kind === 'error') {
      this.failInFlight(WorkerRequestError.fromMessage(message));
      return;
    }

    const slots = new Map<string, ArrayBuffer>();
    for (const binary of envelope.binaries) slots.set(binary.slot, binary.buffer);
    const done = inflight;
    this.inFlight = null;
    if (done.watchdog) clearTimeout(done.watchdog);
    if (done.warn) clearTimeout(done.warn);
    done.resolve({ result: message.result, slots });
  }
}

function formatIssues(issues: readonly ContractIssue[]): string {
  return issues.slice(0, 3).map((i) => `${i.code}@${i.path}`).join('; ');
}
