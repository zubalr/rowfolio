import type {
  AnalysisSnapshot,
  Column,
  ExportArtifact,
  ExportModel,
  Locale,
  NormalizedTable,
  QualityIssue,
  RawTable,
  ScenarioResult,
} from '@rowfolio/contracts';
import { OPERATING_COST_SCENARIO_V1 } from '@rowfolio/contracts';
import { WorkerClient, WorkerRequestError, type StageProgress } from '../workers/client.ts';
import { loadNormalize, loadExportModel } from '../workers/adapters.ts';
import { createAnalysisWorkerFactory, createExportWorkerFactory, type IngestParseOptions } from '../workers/factory.ts';
import type { BinarySlot } from '../workers/transport.ts';
import { loadSampleAssets, SampleError, type SampleAssets } from './sample.ts';
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
  profileTable(raw: RawTable): { proposedColumns: Column[]; issues: QualityIssue[] };
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

async function defaultProfile(raw: RawTable): Promise<{ proposedColumns: Column[]; issues: QualityIssue[] }> {
  const mod = await loadNormalize();
  return mod.profileTable(raw as never) as { proposedColumns: Column[]; issues: QualityIssue[] };
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
    const same = JSON.stringify(this.analysisOptions) === JSON.stringify(parseOptions);
    if (!this.analysis || !same) {
      if (this.analysis) {
        void this.analysis.dispose();
        this.analysis = null;
      }
      const factory = this.deps.createAnalysisClient;
      this.analysis = factory
        ? factory(parseOptions)
        : new WorkerClient(createAnalysisWorkerFactory(parseOptions), {
            onDiagnostic: this.deps.onDiagnostic,
          });
      this.analysisOptions = parseOptions;
    }
    return this.analysis;
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

  private async profile(raw: RawTable): Promise<{ proposedColumns: Column[]; issues: QualityIssue[] }> {
    const fn = this.deps.adapters?.profileTable ?? defaultProfile;
    return fn(raw);
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

  private fail(rid: string, error: unknown): void {
    if (error instanceof WorkerRequestError && error.code === 'CANCELLED') {
      this.dispatch({ type: 'request.cancelled', requestId: rid });
      return;
    }
    this.dispatch({ type: 'request.failed', requestId: rid, error: this.toSessionError(error) });
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
      this.fail(rid, error);
    }
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

    // Source-hash verification: the hash derived inside the worker from the
    // transferred bytes must equal the hash computed where the bytes were
    // read (manifest for the sample, local inspection for uploads).
    const declared = this.state.pending?.source.hash ?? null;
    if (declared && rawTable.sourceRef.sourceHash !== declared) {
      throw { code: 'SCHEMA_MISMATCH', messageKey: 'error.SCHEMA_MISMATCH', recoverable: false } satisfies SessionError;
    }
    this.dispatch({ type: 'ingest.done', requestId: rid, rawTable });

    const profile = await this.profile(rawTable);
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
  ): Promise<void> {
    // The normalize op needs the raw table retained by the ingest worker —
    // reuse the same client; never recreate (worker state is per-instance).
    const client = clientOverride ?? this.analysis;
    if (!client) throw new WorkerRequestError('INTERNAL', 'error.INTERNAL', false, 'analysis worker unavailable');
    const revision = this.state.revision;
    const sessionId = this.state.sessionId;

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
        },
      },
      [],
      this.progressFor(rid),
    )).result as NormalizedTable;

    let snapshot: AnalysisSnapshot;
    if (prepared && prepared.tableId === table.id && prepared.normalizationRevision === table.normalizationRevision) {
      // Validated fast path: the shipped snapshot already binds these bytes.
      snapshot = prepared;
      this.diagnostic('prepared snapshot bound to normalized table revision');
    } else {
      const ar = this.ids.request();
      this.dispatch({ type: 'request.start', requestId: ar });
      const scopeBase = kind === 'sample' ? SAMPLE_SCOPE_BASE : UPLOAD_SCOPE_BASE;
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
      rid = ar;
    }
    this.dispatch({
      type: 'analyze.done',
      requestId: rid,
      sourceHash: table.sourceRef.sourceHash,
      table,
      snapshot,
    });
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
    const model = await this.buildModel(active.snapshot, active.table, this.state.scenario);
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
    this.exportClient?.cancel('user');
  }

  /* ---- lifecycle ---- */

  /** Hard-cancel in-flight analysis work (watchdog-equivalent manual path). */
  cancelWork(reason?: string): void {
    this.analysis?.cancel(reason);
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
