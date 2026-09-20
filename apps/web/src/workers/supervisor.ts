import { ContractError, PROTOCOL_VERSION } from '@rowfolio/contracts';
import type {
  AnalysisSnapshot,
  Column,
  ExportArtifact,
  ExportModel,
  NormalizedTable,
  RawTable,
  ScenarioResult,
} from '@rowfolio/contracts';
import {
  decodeEnvelope,
  encodeResponse,
  requestIssues,
  type BinarySlot,
  type WorkerRequest,
} from './transport.ts';
import {
  AdapterUnavailableError,
  loadAnalysis,
  loadExportWriters,
  loadIngest,
  loadNormalize,
  loadScenario,
} from './adapters.ts';

export const SAMPLE_POLICY_ID = 'sample-manifest-v1';
/** SHA-256 of the bundled `sample_operations.xlsx` bytes (apps/web/public/sample). */
export const BOUND_SAMPLE_SHA256 = 'f0d6d06e934b1eef01d839d071ec7dcdc6d9d47b58ccf556c4eb44f92adb3f5e';

const STAGES = new Set(['preflight', 'parse', 'normalize', 'analyze', 'model', 'layout', 'charts', 'package']);

type ProgressFn = (stage: string, fraction: number | null) => void;

type Post = (message: unknown, transfer: Transferable[]) => void;

interface RequestIds {
  requestId: string;
  sessionId: string;
  revision: number;
}

export interface SupervisorHooks {
  /** Optional out-of-band ingest options (sheet picker values). Read per ingest op. */
  readParseOptions?: () => Record<string, unknown> | null;
  /**
   * Test seam: override adapter module loading. Production path uses the real
   * dynamic imports in `adapters.ts` — overrides must supply real engines.
   */
  adapters?: {
    loadIngest?: typeof loadIngest;
    loadNormalize?: typeof loadNormalize;
    loadAnalysis?: typeof loadAnalysis;
    loadScenario?: typeof loadScenario;
    loadExportWriters?: typeof loadExportWriters;
  };
}

interface ErrorPayload {
  code: string;
  messageKey: string;
  recoverable: boolean;
}

/**
 * Worker-side request dispatcher. Keeps parsed raw tables keyed by rawTableId
 * for the normalize op (contract: retention is per-session; dispose clears).
 * Every response echoes protocolVersion/requestId/sessionId/revision.
 */
export class WorkerSupervisor {
  private readonly rawTables = new Map<string, RawTable>();

  constructor(
    private readonly post: Post,
    private readonly hooks: SupervisorHooks = {},
  ) {}

  async handleMessage(data: unknown): Promise<void> {
    const { envelope } = decodeEnvelope(data);
    if (!envelope) {
      this.postError(unknownIds(data), {
        code: 'SCHEMA_MISMATCH',
        messageKey: 'error.SCHEMA_MISMATCH',
        recoverable: false,
      });
      return;
    }

    const request = envelope.message as WorkerRequest;
    const structural = requestIssues(request);
    if (structural.length > 0) {
      this.postError(idsOf(request), { code: 'SCHEMA_MISMATCH', messageKey: 'error.SCHEMA_MISMATCH', recoverable: false });
      return;
    }
    if (request.protocolVersion !== PROTOCOL_VERSION) {
      this.postError(idsOf(request), { code: 'SCHEMA_MISMATCH', messageKey: 'error.SCHEMA_MISMATCH', recoverable: false });
      return;
    }

    const ids = idsOf(request);
    const progress: ProgressFn = (stage, fraction) => {
      if (!STAGES.has(stage)) return; // progress is advisory; unknown stages are dropped
      this.postMessage({ kind: 'progress', stage, fraction }, ids, []);
    };

    try {
      const outcome = await this.dispatch(request, envelope.binaries, progress);
      this.postMessage({ kind: 'success', result: outcome.result }, ids, outcome.binaries);
    } catch (error) {
      this.postError(ids, mapError(error));
    }
  }

  private postMessage(
    message: { kind: 'progress'; stage: string; fraction: number | null }
      | { kind: 'success'; result: unknown }
      | { kind: 'error' } & ErrorPayload,
    ids: RequestIds,
    binaries: BinarySlot[],
  ): void {
    const wire = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: ids.requestId,
      sessionId: ids.sessionId,
      revision: ids.revision,
      ...message,
    } as Parameters<typeof encodeResponse>[0];
    try {
      const packed = encodeResponse(wire, binaries);
      this.post(packed.envelope, packed.transfer as Transferable[]);
    } catch {
      // If the result itself fails envelope validation, surface an INTERNAL
      // error with no binaries — a malformed artifact must not cross the wire.
      if (message.kind !== 'error') {
        const fallback = encodeResponse({
          protocolVersion: PROTOCOL_VERSION,
          requestId: ids.requestId,
          sessionId: ids.sessionId,
          revision: ids.revision,
          kind: 'error',
          code: 'INTERNAL',
          messageKey: 'error.INTERNAL',
          recoverable: false,
        }, []);
        this.post(fallback.envelope, fallback.transfer as Transferable[]);
      }
    }
  }

  private postError(ids: RequestIds, error: ErrorPayload): void {
    this.postMessage({ kind: 'error', ...error }, ids, []);
  }

  private async dispatch(
    request: WorkerRequest,
    binaries: readonly BinarySlot[],
    progress: ProgressFn,
  ): Promise<{ result: unknown; binaries: BinarySlot[] }> {
    switch (request.operation) {
      case 'ingest':
        return { result: await this.handleIngest(request, binaries, progress), binaries: [] };
      case 'normalize':
        return { result: await this.handleNormalize(request, progress), binaries: [] };
      case 'analyze':
        return { result: await this.handleAnalyze(request), binaries: [] };
      case 'scenario':
        return { result: await this.handleScenario(request), binaries: [] };
      case 'export':
        return this.handleExport(request, progress);
      case 'dispose':
        this.rawTables.clear();
        return { result: { disposed: true }, binaries: [] };
      default:
        throw new AdapterUnavailableError('worker', (request as { operation?: string }).operation ?? 'unknown');
    }
  }

  private async handleIngest(
    request: Extract<WorkerRequest, { operation: 'ingest' }>,
    binaries: readonly BinarySlot[],
    progress: ProgressFn,
  ): Promise<RawTable> {
    const ingest = await (this.hooks.adapters?.loadIngest ?? loadIngest)();
    const slots = new Map<string, ArrayBuffer>();
    for (const binary of binaries) slots.set(binary.slot, binary.buffer);
    const options = this.hooks.readParseOptions?.() ?? null;
    const table = (await ingest.handleIngestRequest(
      request,
      slots,
      progress,
      (options ?? {}) as never,
    )) as RawTable;
    this.rawTables.set(table.id, table);
    return table;
  }

  private async handleNormalize(
    request: Extract<WorkerRequest, { operation: 'normalize' }>,
    progress: ProgressFn,
  ): Promise<NormalizedTable> {
    progress('normalize', null);
    const { rawTableId, approvedIssueIds, columnConfirmations, useUnverifiedFormulaCaches } = request.payload;
    const raw = this.rawTables.get(rawTableId);
    if (!raw) {
      throw new SupervisorError('INTERNAL', 'error.INTERNAL', false, `unknown rawTableId ${rawTableId}`);
    }
    const mod = await (this.hooks.adapters?.loadNormalize ?? loadNormalize)();
    return mod.normalizeTable(raw, {
      issueIds: approvedIssueIds,
      columns: columnConfirmations as readonly Column[],
      useUnverifiedFormulaCaches: useUnverifiedFormulaCaches ?? [],
    } as never) as NormalizedTable;
  }

  private async handleAnalyze(
    request: Extract<WorkerRequest, { operation: 'analyze' }>,
  ): Promise<AnalysisSnapshot> {
    const analysis = await (this.hooks.adapters?.loadAnalysis ?? loadAnalysis)();
    const { table, scope } = request.payload;
    const samplePolicyId =
      table.sourceRef.sourceHash === BOUND_SAMPLE_SHA256 ? SAMPLE_POLICY_ID : null;
    return analysis.analyze(table, {
      version: '1.0.0',
      confirmedScope: scope,
      samplePolicyId,
    } as never) as AnalysisSnapshot;
  }

  private async handleScenario(
    request: Extract<WorkerRequest, { operation: 'scenario' }>,
  ): Promise<ScenarioResult> {
    const scenario = await (this.hooks.adapters?.loadScenario ?? loadScenario)();
    const { snapshot, definition, costChange } = request.payload;
    return scenario.runScenario(snapshot, definition, costChange) as ScenarioResult;
  }

  private async handleExport(
    request: Extract<WorkerRequest, { operation: 'export' }>,
    progress: ProgressFn,
  ): Promise<{ result: ExportArtifact; binaries: BinarySlot[] }> {
    const { model, format } = request.payload;
    let build: (...args: never[]) => unknown;
    try {
      build = await (this.hooks.adapters?.loadExportWriters ?? loadExportWriters)(format);
    } catch (error) {
      throw wrapExportError(error);
    }
    let built: { metadata: ExportArtifact; bytes: ArrayBuffer };
    try {
      built = (await build(model as ExportModel as never, progress as never)) as {
        metadata: ExportArtifact;
        bytes: ArrayBuffer;
      };
    } catch (error) {
      throw wrapExportError(error);
    }
    const slot = built.metadata.binarySlot || 'artifact';
    const artifact = { ...built.metadata, binarySlot: slot };
    return { result: artifact, binaries: [{ slot, buffer: built.bytes }] };
  }
}

export class SupervisorError extends Error {
  readonly code: string;
  readonly messageKey: string;
  readonly recoverable: boolean;
  constructor(code: string, messageKey: string, recoverable: boolean, detail?: string) {
    super(detail ?? code);
    this.name = 'SupervisorError';
    this.code = code;
    this.messageKey = messageKey;
    this.recoverable = recoverable;
  }
}

function wrapExportError(error: unknown): Error {
  const mapped = mapError(error);
  if (mapped.code === 'INTERNAL' || mapped.code === 'UNSUPPORTED') {
    return new SupervisorError(mapped.code === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'EXPORT_FAILED', `error.${mapped.code === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'EXPORT_FAILED'}`, true, mapped.messageKey);
  }
  return error instanceof Error ? error : new SupervisorError(mapped.code, mapped.messageKey, mapped.recoverable);
}

const WORKER_CODES = new Set([
  'INVALID_FILE', 'LIMIT_EXCEEDED', 'AMBIGUOUS_INPUT', 'UNSUPPORTED',
  'CANCELLED', 'TIMEOUT', 'EXPORT_FAILED', 'SCHEMA_MISMATCH', 'INTERNAL',
]);

function mapError(error: unknown): ErrorPayload {
  if (error instanceof SupervisorError) {
    return { code: error.code, messageKey: error.messageKey, recoverable: error.recoverable };
  }
  if (error instanceof AdapterUnavailableError) {
    return { code: 'UNSUPPORTED', messageKey: 'error.UNSUPPORTED', recoverable: true };
  }
  if (error instanceof ContractError) {
    return { code: 'SCHEMA_MISMATCH', messageKey: 'error.SCHEMA_MISMATCH', recoverable: false };
  }
  // Engine errors expose `code` — map known codes through, default INTERNAL.
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && WORKER_CODES.has(code)) {
    const recoverable = (error as { recoverable?: unknown })?.recoverable !== false;
    const messageKey = (error as { messageKey?: unknown })?.messageKey;
    return {
      code,
      messageKey: typeof messageKey === 'string' ? messageKey : `error.${code}`,
      recoverable,
    };
  }
  return { code: 'INTERNAL', messageKey: 'error.INTERNAL', recoverable: false };
}

function idsOf(request: WorkerRequest): RequestIds {
  return { requestId: request.requestId, sessionId: request.sessionId, revision: request.revision };
}

function unknownIds(data: unknown): RequestIds {
  const message = (data as { message?: unknown })?.message;
  if (typeof message === 'object' && message !== null) {
    const m = message as Record<string, unknown>;
    return {
      requestId: typeof m['requestId'] === 'string' ? m['requestId'] : 'unknown',
      sessionId: typeof m['sessionId'] === 'string' ? m['sessionId'] : 'unknown',
      revision: typeof m['revision'] === 'number' ? m['revision'] : 0,
    };
  }
  return { requestId: 'unknown', sessionId: 'unknown', revision: 0 };
}
