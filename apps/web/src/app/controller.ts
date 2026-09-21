import type {
  AnalysisSnapshot,
  Column,
  ExportArtifact,
  ExportModel,
  Locale,
  NormalizedTable,
  ProfileResult,
  RawTable,
  ScenarioResult,
  Hash,
} from '@rowfolio/contracts';
import { OPERATING_COST_SCENARIO_V1 } from '@rowfolio/contracts';
import { WorkerClient, WorkerRequestError, type StageProgress } from '../workers/client.ts';
import { loadExportModel } from '../workers/adapters.ts';
import { createAnalysisWorkerFactory, createExportWorkerFactory, type IngestParseOptions } from '../workers/factory.ts';
import { BOUND_SAMPLE_SHA256 } from '../workers/supervisor.ts';
import type { BinarySlot } from '../workers/transport.ts';
import { loadSampleAssets, SampleError, type SampleAssets } from './sample.ts';
import { setPendingPickerFile } from '../landing/pendingUpload.ts';
import { sessionReducer, type SessionAction } from './reducer.ts';
import {
  initialSession,
  type SessionError,
  type SessionState,
  type SourceInspection,
} from './state.ts';
import type { BlobUrlStore } from './blobUrls.ts';

/** Structural twins for the pure main-thread adapters (deep imports banned). */
export interface MainThreadAdapters {
  inspectSource(
    bytes: ArrayBuffer,
    sourceName: string,
    options?: Record<string, unknown>,
  ): Promise<SourceInspection & { compressedBytes?: number; sourceHash: string }>;
  buildExportModel(
    snapshot: AnalysisSnapshot,
    table: NormalizedTable,
    scenario: ScenarioResult | null,
    locale: Locale,
    numberingSystem: 'latn' | 'arab',
    createdAt: string,
  ): ExportModel;
}

export interface IdGen {
  request(): string;
  session(): string;
}

const defaultIds: () => IdGen = () => {
  let n = 0;
  return {
    request: () => `req-${++n}`,
    session: () => `session-${Date.now().toString(36)}`,
  };
};

export interface ControllerDeps {
  createAnalysisClient?: (parseOptions: IngestParseOptions | null) => WorkerClient;
  createExportClient?: () => WorkerClient;
  fetchSample?: (url: string) => Promise<Response>;
  blobStore?: BlobUrlStore;
  adapters?: Partial<MainThreadAdapters>;
  ids?: IdGen;
  onDiagnostic?: (msg: string) => void;
  locale?: () => { locale: Locale; numberingSystem: 'latn' | 'arab' };
  now?: () => string;
}

type Listener = (state: SessionState) => void;

const SAMPLE_SCOPE_BASE = {
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
  regions: [] as string[],
  complete: true,
  coverageNoteKey: 'coverage.scheduledComplete',
};

const UPLOAD_SCOPE_BASE = {
  periodStart: null,
  periodEnd: null,
  regions: [] as string[],
  complete: false,
  coverageNoteKey: 'coverage.allSource',
};

/** Fixed-key-order, undefined-stripped parse options — worker identity key. */
function canonicalParseOptions(options: IngestParseOptions): IngestParseOptions {
  const out: IngestParseOptions = {};
  if (options.allowHiddenSheet !== undefined) out.allowHiddenSheet = options.allowHiddenSheet;
  if (options.selectedSheetId !== undefined) out.selectedSheetId = options.selectedSheetId;
  if (options.headerRow !== undefined) out.headerRow = options.headerRow;
  if (options.firstColumn !== undefined) out.firstColumn = options.firstColumn;
  if (options.lastColumn !== undefined) out.lastColumn = options.lastColumn;
  if (options.delimiter !== undefined) out.delimiter = options.delimiter;
  return out;
}

async function defaultInspect(
  bytes: ArrayBuffer,
  sourceName: string,
  options?: Record<string, unknown>,
): Promise<SourceInspection & { sourceHash: string }> {
  const { loadIngest } = await import('../workers/adapters.ts');
  const ingest = await loadIngest();
  return (await ingest.inspectSource(bytes, sourceName, options as never) as unknown) as SourceInspection & { sourceHash: string };
}

async function defaultBuildModel(
  snapshot: AnalysisSnapshot,
  table: NormalizedTable,
  scenario: ScenarioResult | null,
  locale: Locale,
  numberingSystem: 'latn' | 'arab',
  createdAt: string,
): Promise<ExportModel> {
  const mod = await loadExportModel();
  return mod.buildExportModel(snapshot as never, table as never, scenario as never, locale as never, numberingSystem as never, createdAt as never) as ExportModel;
}

/**
 * Session orchestrator. Owns the reducer state, the worker clients and the
 * Blob URL registry; React binds via `subscribe`/`getState` (see context.tsx).
 *
 * Sequencing contract:
 * - one analysis-worker request in flight at a time, each with a fresh
 *   requestId echoed through `request.start` so stale async completions die
 *   at the reducer guard;
 * - `cancel()`/`clearSession()` hard-terminate workers (a rejected promise
 *   cannot stop a synchronous parser);
 * - export artifacts bind the committed scenario + locale captured at
 *   `export.begin`.
 */
export class SessionController {
  private state: SessionState;
  private readonly listeners = new Set<Listener>();
  private analysis: WorkerClient | null = null;
  private analysisOptions: IngestParseOptions | null = null;
  private exportClient: WorkerClient | null = null;
  /**
   * Upload-job abort bridge: the upload controller's AbortSignal lives one
   * layer up, but its parse/profile ops run on THIS worker client — an abort
   * must terminate the in-flight worker request, not just drop the result.
   * Bound by parseViaWorker (the signal spans the whole parse→profile job)
   * and released when the outcome is adopted.
   */
  private uploadAbort: { signal: AbortSignal; detach(): void } | null = null;
  /** Last source handed to selectSource — retained so a failed upload can
   *  retry without making the user re-pick the file. */
  private lastSource: { bytes: ArrayBuffer; name: string; format: 'xlsx' | 'csv' } | null = null;
  private readonly ids: IdGen;
  private readonly deps: ControllerDeps;

  constructor(deps: ControllerDeps = {}) {
    this.deps = deps;
    this.ids = deps.ids ?? defaultIds();
    this.state = initialSession(this.ids.session());
  }

  getState(): SessionState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(action: SessionAction): void {
    const next = sessionReducer(this.state, action);
    if (next !== this.state) {
      this.state = next;
      for (const listener of [...this.listeners]) listener(this.state);
    }
  }

  private diagnostic(msg: string): void {
    this.deps.onDiagnostic?.(msg);
  }

  private ensureAnalysis(parseOptions: IngestParseOptions | null): WorkerClient {
    // Canonicalize first — caller key order / undefined fields must not
    // churn the worker identity (a recreation drops retained raw tables).
    const canonical = parseOptions === null ? null : canonicalParseOptions(parseOptions);
    const same = JSON.stringify(this.analysisOptions) === JSON.stringify(canonical);
    if (!this.analysis || !same) {
      if (this.analysis) {
        void this.analysis.dispose();
        this.analysis = null;
      }
      const factory = this.deps.createAnalysisClient;
      this.analysis = factory
        ? factory(canonical)
        : new WorkerClient(createAnalysisWorkerFactory(canonical), {
            onDiagnostic: this.deps.onDiagnostic,
          });
      this.analysisOptions = canonical;
    }
    return this.analysis;
  }

  private bindUploadAbort(signal: AbortSignal | undefined, client: WorkerClient): void {
    this.uploadAbort?.detach();
    this.uploadAbort = null;
    if (!signal) return;
    const onAbort = () => client.cancel('upload aborted');
    if (signal.aborted) {
      // Abort raced the bind — a listener on a dead signal never fires.
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    this.uploadAbort = { signal, detach: () => signal.removeEventListener('abort', onAbort) };
  }

  private unbindUploadAbort(): void {
    this.uploadAbort?.detach();
    this.uploadAbort = null;
  }

  /**
   * UploadFlow parse port — runs ingest inside the analysis worker so the
   * worker retains the RawTable for the subsequent normalize request.
   * ParseOptions travel on the worker `name` channel (v1 wire gap — the
   * ingest op has no options field; flagged for contracts v1.1).
   * `extras.signal` is the upload job's abort: it tears down the worker
   * request — and the profile request of the same job — rather than leaving
   * a parse running against an abandoned upload.
   */
  async parseViaWorker(
    bytes: ArrayBuffer,
    sourceName: string,
    options: IngestParseOptions,
    progress?: ((stage: string, fraction: number | null) => void) | undefined,
    extras?: { delimiter?: ',' | '\t' | ';'; signal?: AbortSignal } | undefined,
  ): Promise<RawTable> {
    const parseOptions: IngestParseOptions = {
      ...options,
      ...(extras?.delimiter !== undefined ? { delimiter: extras.delimiter } : {}),
    };
    const client = this.ensureAnalysis(parseOptions);
    this.bindUploadAbort(extras?.signal, client);
    if (extras?.signal?.aborted) {
      throw new WorkerRequestError('CANCELLED', 'error.CANCELLED', true, 'upload aborted');
    }
    const rid = this.ids.request();
    // Binary sniffing only — the worker re-detects authoritatively.
    const head = new Uint8Array(bytes.slice(0, 4));
    const format = head[0] === 0x50 && head[1] === 0x4b ? 'xlsx' : 'csv';
    const res = await client.request(
      {
        protocolVersion: 1,
        requestId: rid,
        sessionId: this.state.sessionId,
        revision: this.state.revision,
        operation: 'ingest',
        payload: { sourceName, format, byteLength: bytes.byteLength, binarySlot: 'source' },
      },
      // Transfer a copy: postMessage detaches the transferable, and callers
      // retain file.bytes for retry — it must stay attached.
      [{ slot: 'source', buffer: bytes.slice(0) }] as BinarySlot[],
      (p) => progress?.(p.stage, p.fraction),
    );
    return res.result as RawTable;
  }

  /**
   * Profile the raw table retained by the analysis worker — keeps the O(cells)
   * profile off the main thread and against the same retained instance that
   * normalize will resolve by id.
   */
  async profileViaWorker(rawTable: RawTable): Promise<ProfileResult> {
    const client = this.analysis;
    if (!client) throw new WorkerRequestError('INTERNAL', 'error.INTERNAL', false, 'analysis worker unavailable');
    return this.profileOn(client, rawTable);
  }

  /** Profile op on a specific client — always the worker that ingested the table. */
  private async profileOn(client: WorkerClient, rawTable: RawTable): Promise<ProfileResult> {
    const res = await client.request(
      {
        protocolVersion: 1,
        requestId: this.ids.request(),
        sessionId: this.state.sessionId,
        revision: this.state.revision,
        operation: 'profile',
        payload: { rawTableId: rawTable.id },
      },
      [],
    );
    return res.result as ProfileResult;
  }

  /**
   * Adopt a committed UploadFlow outcome: the worker already parsed (and
   * retained) the raw table and the user already approved the review plan,
   * so the session skips straight to normalize → analyze on the live worker.
   */
  async adoptUploadOutcome(outcome: {
    table: RawTable;
    inspection: { format: 'xlsx' | 'csv'; sourceName: string; compressedBytes: number };
    parseOptions: IngestParseOptions;
    approvalPlan: {
      issueIds: readonly string[];
      columns: readonly Column[];
      useUnverifiedFormulaCaches: readonly string[];
    };
    sourceHash: Hash;
  }): Promise<void> {
    // No cancelWork here: the upload flow's parse ran through this client's
    // worker, which retains the raw table normalize resolves by id —
    // cancelling terminates that worker and discards the retained table.
    this.unbindUploadAbort(); // job committed — a later upload abort must not kill normalize
    this.deps.blobStore?.releaseAll();
    this.dispatch({
      type: 'source.begin',
      kind: 'upload',
      source: {
        name: outcome.inspection.sourceName,
        format: outcome.inspection.format,
        byteLength: outcome.inspection.compressedBytes,
        hash: null,
      },
    });
    const rid = this.ids.request();
    let activeRid = rid;
    this.dispatch({ type: 'request.start', requestId: rid });
    try {
      // Hash binding still verified — the worker-derived sourceRef hash must
      // equal the hash the upload flow computed where the bytes were read.
      if (outcome.table.sourceRef.sourceHash !== outcome.sourceHash) {
        throw { code: 'SCHEMA_MISMATCH', messageKey: 'error.SCHEMA_MISMATCH', recoverable: false } satisfies SessionError;
      }
      this.dispatch({
        type: 'source.verified',
        requestId: rid,
        hash: outcome.sourceHash,
        byteLength: outcome.inspection.compressedBytes,
      });
      this.dispatch({ type: 'ingest.done', requestId: rid, rawTable: outcome.table });
      // Review already happened inside the flow — profile.done with no
      // actionable remainder routes straight to analyzing.
      this.dispatch({
        type: 'profile.done',
        requestId: rid,
        columns: [...outcome.approvalPlan.columns],
        issues: [],
      });
      const nr = this.ids.request();
      activeRid = nr;
      this.dispatch({ type: 'request.start', requestId: nr });
      await this.normalizeAndAnalyze(
        nr,
        outcome.table,
        outcome.approvalPlan.issueIds,
        [...outcome.approvalPlan.columns],
        'upload',
        null,
        this.analysis ?? undefined,
        outcome.approvalPlan.useUnverifiedFormulaCaches,
      );
    } catch (error) {
      this.fail(activeRid, error);
    }
  }

  private ensureExport(): WorkerClient {
    if (!this.exportClient) {
      const factory = this.deps.createExportClient;
      this.exportClient = factory
        ? factory()
        : new WorkerClient(createExportWorkerFactory(), { onDiagnostic: this.deps.onDiagnostic });
    }
    return this.exportClient;
  }

  private async inspect(bytes: ArrayBuffer, name: string, options?: Record<string, unknown>) {
    const fn = this.deps.adapters?.inspectSource ?? defaultInspect;
    return fn(bytes, name, options);
  }

  private async buildModel(snapshot: AnalysisSnapshot, table: NormalizedTable, scenario: ScenarioResult | null): Promise<ExportModel> {
    const fn = this.deps.adapters?.buildExportModel ?? defaultBuildModel;
    const { locale, numberingSystem } = this.deps.locale?.() ?? { locale: 'en' as Locale, numberingSystem: 'latn' as const };
    const createdAt = this.deps.now?.() ?? new Date().toISOString();
    return fn(snapshot, table, scenario, locale, numberingSystem, createdAt);
  }

  private toSessionError(error: unknown): SessionError {
    if (error instanceof WorkerRequestError) {
      return { code: error.code, messageKey: error.messageKey, recoverable: error.recoverable };
    }
    if (error instanceof SampleError) {
      return { code: error.code, messageKey: error.messageKey, recoverable: false };
    }
    const code = (error as { code?: unknown })?.code;
    if (typeof code === 'string') {
      return {
        code,
        messageKey: `error.${code}`,
        recoverable: (error as { recoverable?: unknown })?.recoverable !== false,
      };
    }
    return { code: 'INTERNAL', messageKey: 'error.INTERNAL', recoverable: false };
  }

  private fail(rid: string, error: unknown, opts?: { retrySource?: boolean }): void {
    const mapped = this.toSessionError(error);
    if (this.state.requestId !== rid) {
      // The reducer would ignore the dispatch anyway — but a terminal event
      // for a rotated-away request must still reach the diagnostic channel.
      this.diagnostic(`late ${mapped.code === 'CANCELLED' ? 'cancel' : 'failure'} on superseded request (${mapped.code})`);
      return;
    }
    if (mapped.code === 'CANCELLED') {
      this.dispatch({ type: 'request.cancelled', requestId: rid });
      return;
    }
    this.dispatch({
      type: 'request.failed',
      requestId: rid,
      error:
        opts?.retrySource === true && mapped.recoverable && this.lastSource !== null
          ? { ...mapped, retrySource: true }
          : mapped,
    });
  }

  private progressFor(rid: string) {
    return (p: StageProgress) =>
      this.dispatch({ type: 'worker.progress', requestId: rid, stage: p.stage, fraction: p.fraction });
  }

  /**
   * Prepared-sample entry: fetch index.json → fetch workbook → verify SHA-256
   * against the bound hash → ingest (manifest parse options via worker `name`
   * channel) → profile → manifest-approved normalize → analyze (or validated
   * prepared snapshot) → ready.
   */
  async useSample(): Promise<void> {
    if (this.state.phase === 'reading' || this.state.phase === 'profiling' || this.state.phase === 'analyzing') return;
    this.cancelWork('new source');
    this.deps.blobStore?.releaseAll();
    this.dispatch({
      type: 'source.begin',
      kind: 'sample',
      source: { name: 'sample_operations.xlsx', format: 'xlsx', byteLength: 0, hash: null },
    });
    const rid = this.ids.request();
    this.dispatch({ type: 'request.start', requestId: rid });
    try {
      const assets = await loadSampleAssets(this.deps.fetchSample as never);
      if (this.state.requestId !== rid) return; // superseded mid-flight
      this.dispatch({
        type: 'source.verified',
        requestId: rid,
        hash: assets.workbookHash,
        byteLength: assets.workbookBytes.byteLength,
      });
      await this.runIngestProfileAnalyze(rid, assets.workbookBytes, 'sample_operations.xlsx', 'xlsx', assets.parseOptions, assets);
    } catch (error) {
      this.fail(rid, error);
    }
  }

  /**
   * Upload entry: inspect (bounded, main thread) → ingest → profile →
   * needsReview or straight to analyze for clean sources.
   * `parseOptions` comes from the upload sheet picker (A17 slot).
   */
  async selectSource(
    bytes: ArrayBuffer,
    sourceName: string,
    format: 'xlsx' | 'csv',
    parseOptions: IngestParseOptions | null = null,
  ): Promise<void> {
    this.cancelWork('new source');
    this.deps.blobStore?.releaseAll();
    this.lastSource = { bytes, name: sourceName, format };
    this.dispatch({
      type: 'source.begin',
      kind: 'upload',
      source: { name: sourceName, format, byteLength: bytes.byteLength, hash: null },
    });
    const rid = this.ids.request();
    this.dispatch({ type: 'request.start', requestId: rid });
    try {
      const inspection = await this.inspect(bytes, sourceName, undefined);
      if (this.state.requestId !== rid) return;
      this.dispatch({
        type: 'source.inspected',
        requestId: rid,
        inspection: {
          format: inspection.format,
          sourceName: inspection.sourceName,
          sourceHash: inspection.sourceHash,
          sheets: inspection.sheets,
          defaultSheetId: inspection.defaultSheetId,
          hiddenSheets: inspection.hiddenSheets,
        },
        hash: inspection.sourceHash,
        byteLength: bytes.byteLength,
      });
      const options = parseOptions ?? defaultParseFromInspection(inspection);
      await this.runIngestProfileAnalyze(rid, bytes, sourceName, format, options, null);
    } catch (error) {
      const detail = (error as { detail?: unknown })?.detail;
      const code = (error as { code?: unknown })?.code;
      if (code === 'AMBIGUOUS_INPUT' && detail === 'csv.ambiguous-delimiter') {
        // Not a failure — the file needs a user decision the session
        // pipeline cannot express. Hand it to the upload flow's configure
        // stage (delimiter picker) via the pending-picker slot; it claims
        // the file the moment phase returns to idle.
        setPendingPickerFile({ name: sourceName, bytes });
        this.dispatch({ type: 'upload.deferToPicker', requestId: rid });
        return;
      }
      this.fail(rid, error, { retrySource: true });
    }
  }

  /**
   * Retry the last `selectSource` after a recoverable failure — the bytes
   * were retained, so the user does not re-pick the file.
   */
  retrySource(): void {
    if (this.state.error?.retrySource !== true || this.lastSource === null) return;
    const { bytes, name, format } = this.lastSource;
    void this.selectSource(bytes, name, format);
  }

  /** Needs-review confirmation → normalize with the approved plan → analyze. */
  async approveReview(approvedIssueIds: readonly string[], columnConfirmations: readonly Column[]): Promise<void> {
    const pending = this.state.pending;
    if (this.state.phase !== 'needsReview' || !pending?.rawTable) return;
    const rid = this.ids.request();
    this.dispatch({ type: 'review.approve', requestId: rid });
    this.dispatch({ type: 'request.start', requestId: rid });
    try {
      await this.normalizeAndAnalyze(rid, pending.rawTable, approvedIssueIds, columnConfirmations, pending.kind);
    } catch (error) {
      this.fail(rid, error);
    }
  }

  private async runIngestProfileAnalyze(
    rid: string,
    bytes: ArrayBuffer,
    sourceName: string,
    format: 'xlsx' | 'csv',
    parseOptions: IngestParseOptions | null,
    assets: SampleAssets | null,
  ): Promise<void> {
    const revision = this.state.revision;
    const sessionId = this.state.sessionId;
    const client = this.ensureAnalysis(parseOptions);

    const rawTable = (await client.request(
      {
        protocolVersion: 1,
        requestId: rid,
        sessionId,
        revision,
        operation: 'ingest',
        payload: { sourceName, format, byteLength: bytes.byteLength, binarySlot: 'source' },
      },
      [{ slot: 'source', buffer: bytes }] as BinarySlot[],
      this.progressFor(rid),
    )).result as RawTable;

    // A superseding source may have rotated the live requestId while this
    // request was in flight — resume only if still current.
    if (this.state.requestId !== rid) {
      this.diagnostic('ingest resolved for a superseded request — dropping result');
      return;
    }

    // Source-hash verification: the hash derived inside the worker from the
    // transferred bytes must equal the hash computed where the bytes were
    // read (manifest for the sample, local inspection for uploads).
    const declared = this.state.pending?.source.hash ?? null;
    if (declared && rawTable.sourceRef.sourceHash !== declared) {
      throw { code: 'SCHEMA_MISMATCH', messageKey: 'error.SCHEMA_MISMATCH', recoverable: false } satisfies SessionError;
    }
    this.dispatch({ type: 'ingest.done', requestId: rid, rawTable });

    // Profile runs as a watchdogged worker op against the retained raw table —
    // a main-thread profile await has no watchdog and a stuck adapter used to
    // leave the session parked at 'profiling' forever.
    const profile = await this.profileOn(client, rawTable);
    if (this.state.requestId !== rid) {
      this.diagnostic('profile resolved for a superseded request — dropping result');
      return;
    }
    this.dispatch({ type: 'profile.done', requestId: rid, columns: profile.proposedColumns, issues: profile.issues });

    if (this.state.phase === 'needsReview') return; // waits for approveReview

    // Sample sources carry manifest approvals: proposed fixes (action ≠ none)
    // are pre-approved by the bound sample policy. Clean uploads have no
    // actionable issues, so the same filter yields [] — normalize as-proposed.
    const approvedIssueIds = profile.issues.filter((i) => i.action !== 'none').map((i) => i.id);
    const nr = this.ids.request();
    this.dispatch({ type: 'request.start', requestId: nr });
    try {
      await this.normalizeAndAnalyze(nr, rawTable, approvedIssueIds, profile.proposedColumns, assets ? 'sample' : 'upload', assets?.preparedSnapshot ?? null, client);
    } catch (error) {
      this.fail(nr, error);
    }
  }

  private async normalizeAndAnalyze(
    rid: string,
    rawTable: RawTable,
    approvedIssueIds: readonly string[],
    columns: readonly Column[],
    kind: 'sample' | 'upload',
    prepared: AnalysisSnapshot | null = null,
    clientOverride?: WorkerClient,
    useUnverifiedFormulaCaches: readonly string[] = [],
  ): Promise<void> {
    // The normalize op needs the raw table retained by the ingest worker —
    // reuse the same client; never recreate (worker state is per-instance).
    const client = clientOverride ?? this.analysis;
    if (!client) throw new WorkerRequestError('INTERNAL', 'error.INTERNAL', false, 'analysis worker unavailable');
    const revision = this.state.revision;
    const sessionId = this.state.sessionId;

    // `active` tracks the request id the reducer considers current: normalize
    // runs on `rid`, then `request.start` for the analyze sub-request moves the
    // current id to `ar` — failures must be reported on the id that is live.
    let active = rid;
    try {
      const table = (await client.request(
        {
          protocolVersion: 1,
          requestId: rid,
          sessionId,
          revision,
          operation: 'normalize',
          payload: {
            rawTableId: rawTable.id,
            approvedIssueIds: [...approvedIssueIds],
            columnConfirmations: [...columns],
            useUnverifiedFormulaCaches: [...useUnverifiedFormulaCaches],
          },
        },
        [],
        this.progressFor(rid),
      )).result as NormalizedTable;

      // `request.start` is unguarded in the reducer — a superseded coroutine
      // must never stamp a fresh requestId over the live pipeline.
      if (this.state.requestId !== active) {
        this.diagnostic('normalize resolved for a superseded request — dropping result');
        return;
      }

      let snapshot: AnalysisSnapshot;
      if (prepared && prepared.tableId === table.id && prepared.normalizationRevision === table.normalizationRevision) {
        // Validated fast path: the shipped snapshot already binds these bytes.
        snapshot = prepared;
        this.diagnostic('prepared snapshot bound to normalized table revision');
      } else {
        const ar = this.ids.request();
        active = ar;
        this.dispatch({ type: 'request.start', requestId: ar });
        // The analyze op emits no stage progress — mark it honestly as soon
        // as the request is live so the UI doesn't sit on 'normalize'.
        this.dispatch({ type: 'worker.progress', requestId: ar, stage: 'analyze', fraction: null });
        // The bound sample keeps its declared June-2026 scope even when it
        // arrives via the upload path — the supervisor pins the same
        // samplePolicyId from the hash, and sample-pack analysis requires a
        // bounded period scope.
        const boundSample = table.sourceRef.sourceHash === BOUND_SAMPLE_SHA256;
        const scopeBase = kind === 'sample' || boundSample ? SAMPLE_SCOPE_BASE : UPLOAD_SCOPE_BASE;
        snapshot = (await client.request(
          {
            protocolVersion: 1,
            requestId: ar,
            sessionId,
            revision,
            operation: 'analyze',
            payload: { table, scope: { ...scopeBase, tableId: table.id } },
          },
          [],
          this.progressFor(ar),
        )).result as AnalysisSnapshot;
        if (this.state.requestId !== active) {
          this.diagnostic('analyze resolved for a superseded request — dropping result');
          return;
        }
      }
      rid = active;
      this.dispatch({
        type: 'analyze.done',
        requestId: rid,
        sourceHash: table.sourceRef.sourceHash,
        table,
        snapshot,
      });
    } catch (error) {
      this.fail(active, error);
    }
  }

  /* ---- findings & evidence ---- */

  selectFinding(findingId: string): void {
    this.dispatch({ type: 'finding.select', findingId });
  }

  openEvidence(findingId: string): void {
    this.dispatch({ type: 'evidence.open', findingId });
  }

  closeEvidence(): void {
    this.dispatch({ type: 'evidence.close' });
  }

  /* ---- scenario ---- */

  setScenarioInput(text: string): void {
    this.dispatch({ type: 'scenario.input', text });
  }

  /**
   * Submit a scenario. `costChange` is a canonical decimal fraction string
   * (e.g. "0.08" for +8%) validated by the caller/UI against the definition —
   * the worker re-validates; invalid results never commit.
   */
  async submitScenario(costChange: string): Promise<void> {
    const snapshot = this.state.active?.snapshot;
    if (!snapshot) return;
    const rid = this.ids.request();
    this.dispatch({ type: 'scenario.submit', requestId: rid, costChange });
    try {
      // Reuse the live analysis worker — scenario carries no ingest options,
      // and recreating would drop the retained raw table.
      const client = this.analysis ?? this.ensureAnalysis(null);
      const result = (await client.request(
        {
          protocolVersion: 1,
          requestId: rid,
          sessionId: this.state.sessionId,
          revision: this.state.revision,
          operation: 'scenario',
          payload: { snapshot, definition: OPERATING_COST_SCENARIO_V1, costChange },
        },
        [],
      )).result as ScenarioResult;
      this.dispatch({ type: 'scenario.done', requestId: rid, costChange, result });
    } catch (error) {
      if (this.state.scenarioRequestId !== rid) {
        this.diagnostic('late scenario failure on a superseded request — dropping');
        return;
      }
      if (error instanceof WorkerRequestError && error.code === 'CANCELLED') {
        this.dispatch({ type: 'scenario.failed', requestId: rid, error: { code: 'CANCELLED', messageKey: 'error.CANCELLED', recoverable: true } });
      } else {
        this.dispatch({ type: 'scenario.failed', requestId: rid, error: this.toSessionError(error) });
      }
    }
  }

  resetScenario(): void {
    this.dispatch({ type: 'scenario.reset' });
  }

  /* ---- export ---- */

  openExport(): void {
    this.dispatch({ type: 'export.open' });
  }

  closeExport(): void {
    this.dispatch({ type: 'export.close' });
  }

  /**
   * Export preparation: build the briefing model on the committed snapshot +
   * committed scenario + current locale, then build xlsx → pptx sequentially
   * on the export worker. Partial failure keeps completed artifacts.
   */
  async prepareExport(): Promise<void> {
    const active = this.state.active;
    if (!active || this.state.phase !== 'ready') return;
    // A live requestId through the (unwatchdogged) model build lets
    // cancelWork/cancelExport abort before export.begin, and gives model
    // failures the same typed error surface as worker failures.
    const rid = this.ids.request();
    this.dispatch({ type: 'request.start', requestId: rid });
    let model: ExportModel;
    try {
      model = await this.buildModel(active.snapshot, active.table, this.state.scenario);
    } catch (error) {
      this.fail(rid, error);
      return;
    }
    if (this.state.requestId !== rid || this.state.active !== active) {
      this.diagnostic('export superseded during model build — dropping result');
      return;
    }
    this.dispatch({ type: 'export.begin', model });
    const client = this.ensureExport();
    for (const format of ['xlsx', 'pptx'] as const) {
      try {
        const res = await client.request(
          {
            protocolVersion: 1,
            requestId: this.ids.request(),
            sessionId: this.state.sessionId,
            revision: this.state.revision,
            operation: 'export',
            payload: { model, format },
          },
          [],
          (p) => this.dispatch({ type: 'export.progress', stage: p.stage, fraction: p.fraction }),
        );
        const artifact = res.result as ExportArtifact;
        const bytes = res.slots.get(artifact.binarySlot);
        if (!bytes) {
          this.dispatch({ type: 'export.failed', format, code: 'SCHEMA_MISMATCH', messageKey: 'error.SCHEMA_MISMATCH' });
          continue;
        }
        const url = this.deps.blobStore?.register(new Blob([bytes], { type: artifact.mime })) ?? '';
        this.dispatch({ type: 'export.done', format, entry: { artifact, url } });
      } catch (error) {
        const sessionError = this.toSessionError(error);
        this.dispatch({ type: 'export.failed', format, code: sessionError.code, messageKey: sessionError.messageKey });
        if (sessionError.code === 'CANCELLED') break;
      }
    }
    this.dispatch({ type: 'export.finished' });
  }

  cancelExport(): void {
    // Cover the pre-export.begin window: the model build holds a requestId
    // but the export client may not exist yet.
    if (this.state.requestId) {
      this.dispatch({ type: 'request.cancelled', requestId: this.state.requestId });
    }
    this.exportClient?.cancel('user');
  }

  /* ---- lifecycle ---- */

  /** Hard-cancel in-flight analysis work (watchdog-equivalent manual path). */
  cancelWork(reason?: string): void {
    // Cancel the live request at the reducer first: a worker-side rejection
    // may never arrive (nothing in-flight, or the rid already rotated), and
    // a missing dispatch leaves the pending phase stuck with a dead Cancel.
    if (this.state.requestId) {
      this.dispatch({ type: 'request.cancelled', requestId: this.state.requestId });
    }
    this.analysis?.cancel(reason);
    this.exportClient?.cancel(reason);
    if (this.state.scenarioRequestId) {
      this.dispatch({ type: 'scenario.failed', requestId: this.state.scenarioRequestId, error: { code: 'CANCELLED', messageKey: 'error.CANCELLED', recoverable: true } });
    }
  }

  /** Back to the committed dataset baseline (replay the demo flow). */
  replay(): void {
    this.dispatch({ type: 'session.replay' });
  }

  /** Full teardown: dispose workers, revoke Blob URLs, reset the session. */
  async clearSession(): Promise<void> {
    const analysis = this.analysis;
    const exporter = this.exportClient;
    this.analysis = null;
    this.exportClient = null;
    this.deps.blobStore?.releaseAll();
    await Promise.allSettled([analysis?.dispose(), exporter?.dispose()]);
    this.dispatch({ type: 'session.clear', sessionId: this.ids.session() });
  }

  /** React unmount hook — same teardown as clearSession minus the dispatch. */
  async dispose(): Promise<void> {
    this.deps.blobStore?.releaseAll();
    const analysis = this.analysis;
    const exporter = this.exportClient;
    this.analysis = null;
    this.exportClient = null;
    await Promise.allSettled([analysis?.dispose(), exporter?.dispose()]);
  }
}

function defaultParseFromInspection(inspection: { defaultSheetId: string | null }): IngestParseOptions | null {
  if (!inspection.defaultSheetId) return null;
  return { selectedSheetId: inspection.defaultSheetId, allowHiddenSheet: false };
}
