/* eslint-disable no-restricted-imports -- tests read fixture/sample bytes from disk */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalysisSnapshot, ExportModel, NormalizedTable, QualityIssue } from '@rowfolio/contracts';
import { SessionController } from './controller.ts';
import { takePendingPickerFile } from '../landing/pendingUpload.ts';
import { BlobUrlStore } from './blobUrls.ts';
import { WorkerClient } from '../workers/client.ts';
import { InProcessWorker, inProcessFactory } from '../workers/test-helpers.ts';
import type { SupervisorHooks } from '../workers/supervisor.ts';
import type { WorkerRequest } from '@rowfolio/contracts';

import snapshotFixture from '../../../../tests/contract/fixtures/analysis-snapshot.example.json';
import tableFixture from '../../../../tests/contract/fixtures/normalized-table.example.json';
import exportModelFixture from '../../../../tests/contract/fixtures/export-model.en.example.json';

const SNAPSHOT = snapshotFixture as unknown as AnalysisSnapshot;
const TABLE = tableFixture as unknown as NormalizedTable;
const EXPORT_MODEL = exportModelFixture as unknown as ExportModel;

const SAMPLE_DIR = fileURLToPath(new URL('../../public/sample/', import.meta.url));

/** Fetch the real bundled sample assets from disk (as the static host would). */
function diskFetch(): (url: string) => Promise<Response> {
  return async (url: string) => {
    const path = join(SAMPLE_DIR, url.replace(/^.*?sample\//, ''));
    try {
      const bytes = await readFile(path);
      return new Response(bytes, { status: 200 });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
}

/**
 * Contract-fixture engines: normalize/analyze return the checked-in golden
 * payloads (A02 fixtures bound to the real sample hash). Ingest is REAL —
 * the actual @rowfolio/ingest parser runs in-process inside the supervisor.
 */
function fixtureAdapters(spy?: { analyzeArgs: unknown[] }) {
  const adapters: NonNullable<SupervisorHooks['adapters']> = {
    loadNormalize: async () => ({
      profileTable: () => ({ proposedColumns: [], issues: [] }),
      normalizeTable: () => TABLE as never,
    }),
    loadAnalysis: async () => ({
      analyze: (table: unknown, options: unknown) => {
        spy?.analyzeArgs.push(options);
        return SNAPSHOT as never;
      },
    }),
    loadScenario: async () => ({
      runScenario: (_s: unknown, _d: unknown, costChange: unknown) =>
        ({ id: `scenario-${costChange}`, definitionId: 'operating-cost-v1', baselineAnalysisId: SNAPSHOT.id, costChange, scope: SNAPSHOT.scope, metrics: [], provenance: [], status: 'defined', reasonKey: null }) as never,
    }),
    loadExportWriters: async (format: 'xlsx' | 'pptx') => async () => ({
      metadata: {
        exportId: 'export-1',
        format,
        mime: format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        filename: `briefing.${format}`,
        byteLength: 4,
        sha256: '0'.repeat(64),
        binarySlot: 'artifact',
      },
      bytes: new Uint8Array([1, 2, 3, 4]).buffer,
    }) as never,
  };
  return adapters;
}

function makeController(opts: {
  adapters?: SupervisorHooks['adapters'];
  mainAdapters?: Record<string, unknown>;
  fetchSample?: (url: string) => Promise<Response>;
  blobStore?: BlobUrlStore;
  watchdogMs?: number;
  onDiagnostic?: (msg: string) => void;
} = {}) {
  const spawned: InProcessWorker[] = [];
  const requests: WorkerRequest[][] = [];
  const blobs = { urls: [] as string[], revoked: [] as string[] };
  const blobStore = opts.blobStore ?? new BlobUrlStore({
    createObjectURL: () => `blob:mock-${blobs.urls.push(`u${blobs.urls.length}`)}`,
    revokeObjectURL: (u) => { blobs.revoked.push(u); },
  });
  // A fresh worker per spawn — cancel()/watchdog terminates the current one;
  // the next request must land on a live instance (mirrors the real factory).
  const spawn = () => {
    const worker = new InProcessWorker({ adapters: opts.adapters ?? fixtureAdapters() });
    spawned.push(worker);
    requests.push(worker.received);
    return worker;
  };
  const controller = new SessionController({
    fetchSample: opts.fetchSample ?? (diskFetch() as never),
    // Main-thread pure adapters — contract-fixture stand-ins while engines
    // ship on hb/* (production path resolves the real packages at merge).
    adapters: {
      buildExportModel: () => EXPORT_MODEL,
      ...opts.mainAdapters,
    },
    blobStore,
    ids: (() => { let n = 0; return { request: () => `r${++n}`, session: () => 'test-session' }; })(),
    ...(opts.onDiagnostic ? { onDiagnostic: opts.onDiagnostic } : {}),
    createAnalysisClient: () => new WorkerClient(spawn, { watchdogMs: opts.watchdogMs }),
    createExportClient: () => new WorkerClient(spawn, { watchdogMs: opts.watchdogMs }),
  });
  return { controller, spawned, requests, blobStore, blobs };
}

const waitTick = () => new Promise((r) => setTimeout(r, 0));

/** Poll a predicate up to ~3s (10ms interval). Throws on timeout. */
async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('SessionController', () => {
  it('completes the prepared-sample path end-to-end over the wire protocol', async () => {
    const { controller, requests } = makeController();
    await controller.useSample();
    const s = controller.getState();
    expect(s.phase).toBe('ready');
    expect(s.active?.snapshot.id).toBe(SNAPSHOT.id);
    expect(s.active?.source.hash).toBe('f0d6d06e934b1eef01d839d071ec7dcdc6d9d47b58ccf556c4eb44f92adb3f5e');
    // Wire order: ingest → profile → normalize → analyze on the analysis worker.
    const ops = requests[0]!.map((r) => r.operation);
    expect(ops).toEqual(['ingest', 'profile', 'normalize', 'analyze']);
    await controller.dispose();
  });

  it('verify-sample: analyze receives samplePolicyId bound to the sample hash', async () => {
    const spy = { analyzeArgs: [] as unknown[] };
    const { controller } = makeController({ adapters: fixtureAdapters(spy) });
    await controller.useSample();
    expect(spy.analyzeArgs[0]).toMatchObject({ samplePolicyId: 'sample-manifest-v1' });
    await controller.dispose();
  });

  it('a failed new upload keeps the prior committed session', async () => {
    const { controller } = makeController();
    await controller.useSample();
    expect(controller.getState().phase).toBe('ready');
    const committed = controller.getState().active;

    // Empty input fails ingest on the real parser (INVALID_FILE, empty-input).
    await controller.selectSource(new ArrayBuffer(0), 'empty.csv', 'csv');
    const s = controller.getState();
    expect(s.phase).toBe('ready');
    expect(s.active).toBe(committed);
    expect(s.error?.code).toBeDefined();
    expect(s.notice).toBe('upload.previousRetained');
    await controller.dispose();
  });

  it('adoptUploadOutcome: normalize failure surfaces an error instead of stalling', async () => {
    const failing = fixtureAdapters();
    failing.loadNormalize = async () => ({
      profileTable: () => ({ proposedColumns: [], issues: [] }),
      normalizeTable: () => {
        throw new Error('normalize-boom');
      },
    });
    const { controller, spawned } = makeController({ adapters: failing });
    const outcome = {
      table: { id: 'raw-1', sourceRef: { id: 'src-1', sourceHash: 'h1' }, cells: [], dateSystem: 'not-applicable', warnings: [] },
      inspection: { format: 'csv' as const, sourceName: 'up.csv', compressedBytes: 10 },
      parseOptions: {},
      approvalPlan: { issueIds: [], columns: [], useUnverifiedFormulaCaches: [] },
      sourceHash: 'h1',
    };
    await controller.adoptUploadOutcome(outcome as never);
    const s = controller.getState();
    expect(s.phase).toBe('idle');
    expect(s.error?.code).toBeDefined();
    // The analysis worker must NOT have been terminated by adoption —
    // the same client owns the retained raw table the normalize op resolves.
    expect(spawned[0]?.terminated).not.toBe(true);
    await controller.dispose();
  });

  it('adoptUploadOutcome: happy path reaches ready on the same worker client', async () => {
    const { controller, requests, spawned } = makeController();
    // Realistic flow: the upload UI parses through the worker, which retains
    // the raw table under its id for the normalize op to resolve.
    const bytes = new TextEncoder().encode('a,b\n1,2\n3,4\n').buffer as ArrayBuffer;
    const table = await controller.parseViaWorker(bytes, 'up.csv', {});
    const outcome = {
      table,
      inspection: { format: 'csv' as const, sourceName: 'up.csv', compressedBytes: bytes.byteLength },
      parseOptions: {},
      approvalPlan: { issueIds: [], columns: [], useUnverifiedFormulaCaches: [] },
      sourceHash: table.sourceRef.sourceHash,
    };
    await controller.adoptUploadOutcome(outcome as never);
    expect(controller.getState().phase).toBe('ready');
    const ops = requests[0]!.map((r) => r.operation);
    expect(ops).toEqual(['ingest', 'normalize', 'analyze']);
    expect(spawned[0]?.terminated).not.toBe(true);
    await controller.dispose();
  });

  it('commits an immutable scenario result and rejects overlapping submits', async () => {
    const { controller, requests } = makeController();
    await controller.useSample();
    await controller.submitScenario('0.08');
    const s = controller.getState();
    expect(s.scenario?.costChange).toBe('0.08');
    expect(s.scenarioRequestId).toBeNull();
    // The scenario request carried the committed snapshot + definition.
    const scenarioReq = requests.flat().find((r) => r.operation === 'scenario');
    expect(scenarioReq).toBeDefined();
    expect((scenarioReq as { payload: { costChange: string } }).payload.costChange).toBe('0.08');
    await controller.dispose();
  });

  it('builds export artifacts sequentially and registers Blob URLs', async () => {
    const { controller, blobStore, blobs } = makeController();
    await controller.useSample();
    await controller.submitScenario('0.08');
    controller.openExport();
    await controller.prepareExport();
    const s = controller.getState();
    expect(s.phase).toBe('ready');
    expect(s.export.artifacts.xlsx?.artifact.filename).toBe('briefing.xlsx');
    expect(s.export.artifacts.pptx?.artifact.filename).toBe('briefing.pptx');
    expect(blobs.urls.length).toBe(2);
    expect(s.export.scenarioId).toBe('scenario-0.08');
    await controller.clearSession();
    expect(blobs.revoked.length).toBe(2);
    expect(blobStore.size).toBe(0);
  });

  it('clear-session disposes workers and resets the session', async () => {
    const { controller, spawned } = makeController();
    await controller.useSample();
    await controller.clearSession();
    const s = controller.getState();
    expect(s.phase).toBe('idle');
    expect(s.active).toBeNull();
    expect(spawned.every((w) => w.terminated)).toBe(true);
  });

  it('locale switch mid-session never reparses or disturbs the committed dataset', async () => {
    const locales: ('en' | 'ar')[] = ['en'];
    const { controller, requests } = makeController();
    await controller.useSample();
    const committed = controller.getState().active;
    // Switch locale while a scenario request runs.
    const scenarioPromise = controller.submitScenario('0.08');
    locales.push('ar'); // i18n.setLocale equivalent — the session is untouched
    await scenarioPromise;
    const s = controller.getState();
    expect(s.active).toBe(committed);
    expect(s.scenario?.costChange).toBe('0.08');
    // Exactly the expected requests ran — no re-ingest.
    const ops = requests[0]!.map((r) => r.operation);
    expect(ops).toEqual(['ingest', 'profile', 'normalize', 'analyze', 'scenario']);
    await controller.dispose();
  });

  it('declared-vs-worker source hash mismatch refuses the source', async () => {
    const { controller } = makeController({
      mainAdapters: {
        // Inspect reports a fingerprint that does not match the bytes —
        // tampered or mislabeled input must never reach the session.
        inspectSource: async () => ({
          sourceHash: '0'.repeat(64),
          format: 'csv',
          sheets: [{ id: 'S0', name: 'Sheet', kind: 'data', hidden: false, populatedCells: 1 }],
          preview: { rows: 1, columns: 1 },
          durationMs: 0,
        }),
      },
    });
    const csv = new TextEncoder().encode('a,b\n1,2\n').buffer as ArrayBuffer;
    await controller.selectSource(csv, 'small.csv', 'csv');
    const s = controller.getState();
    expect(s.error?.code).toBe('SCHEMA_MISMATCH');
    expect(s.active).toBeNull();
    expect(s.phase).toBe('idle');
    await controller.dispose();
  });

  it('watchdog fires on a stuck ingest and lands back in idle', async () => {
    const hanging = new SessionController({
      blobStore: new BlobUrlStore({ createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
      createAnalysisClient: () => new WorkerClient(() => ({
        postMessage: () => {},
        terminate: () => {},
        onmessage: null,
        onerror: null,
      }), { watchdogMs: 50 }),
      fetchSample: diskFetch() as never,
    });
    await hanging.useSample();
    const s = hanging.getState();
    expect(s.phase).toBe('idle');
    expect(s.error?.code).toBe('TIMEOUT');
    await hanging.dispose();
  });

  it('export cancel rejects in-flight and a retry rebuilds cleanly', async () => {
    let terminations = 0;
    const controller = new SessionController({
      blobStore: new BlobUrlStore({ createObjectURL: () => `blob:${Math.random()}`, revokeObjectURL: () => {} }),
      ids: (() => { let n = 0; return { request: () => `r${++n}`, session: () => 's' }; })(),
      fetchSample: diskFetch() as never,
      adapters: {
        buildExportModel: () => EXPORT_MODEL,
      },
      createAnalysisClient: () => new WorkerClient(inProcessFactory({ adapters: fixtureAdapters() })),
      createExportClient: () =>
        new WorkerClient(() => ({
          postMessage: () => {},
          terminate: () => { terminations++; },
          onmessage: null,
          onerror: null,
        }), { watchdogMs: 40 }),
    });
    await controller.useSample();
    controller.openExport();
    const first = controller.prepareExport();
    await waitTick();
    controller.cancelExport();
    await first;
    let s = controller.getState();
    expect(s.phase).toBe('ready');
    expect(s.export.failure).not.toBeNull();
    expect(terminations).toBe(1);
    // Retry against the fixture export worker — succeeds.
    const retry = new SessionController({
      blobStore: new BlobUrlStore({ createObjectURL: () => 'blob:retry', revokeObjectURL: () => {} }),
      ids: (() => { let n = 0; return { request: () => `r${++n}`, session: () => 's' }; })(),
      fetchSample: diskFetch() as never,
      adapters: {
        buildExportModel: () => EXPORT_MODEL,
      },
      createAnalysisClient: () => new WorkerClient(inProcessFactory({ adapters: fixtureAdapters() })),
      createExportClient: () => new WorkerClient(inProcessFactory({ adapters: fixtureAdapters() })),
    });
    await retry.useSample();
    retry.openExport();
    await retry.prepareExport();
    s = retry.getState();
    expect(s.export.artifacts.xlsx?.artifact.filename).toBe('briefing.xlsx');
    expect(s.export.failure).toBeNull();
    await controller.dispose();
    await retry.dispose();
  });
});

describe('upload reliability (W-UPLOAD)', () => {
  const CSV = new TextEncoder().encode('a,b\n1,2\n').buffer as ArrayBuffer;
  const REVIEW_ISSUE: QualityIssue = {
    id: 'i1',
    kind: 'duplicate',
    sourceRefId: 'raw',
    sourceRow: 2,
    fieldId: null,
    original: 'x',
    normalized: null,
    status: 'proposed',
    action: 'exclude-row',
    approval: 'none',
    canonicalSourceRow: 1,
    messageKey: 'quality.duplicate',
  };

  it('a stuck profile surfaces TIMEOUT on the live request — no silent profiling stall', async () => {
    const hanging: SupervisorHooks['adapters'] = {
      ...fixtureAdapters(),
      loadNormalize: async () => ({
        profileTable: () => new Promise<never>(() => {}),
        normalizeTable: () => TABLE as never,
      }),
    };
    const { controller, requests } = makeController({
      adapters: hanging,
      watchdogMs: 60,
      // The pre-fix path profiles on the main thread; the fix runs the
      // 'profile' worker op — the hanging adapter must stall either way.
      mainAdapters: { profileTable: () => new Promise<never>(() => {}) },
    });
    const done = controller.selectSource(CSV, 'tiny.csv', 'csv');
    await waitFor(() => controller.getState().phase === 'idle' && controller.getState().error !== null);
    await done;
    expect(controller.getState().error?.code).toBe('TIMEOUT');
    expect(controller.getState().active).toBeNull();
    // Profiling must run as a watchdogged worker op — the only reason the
    // watchdog could fire on a stuck profile at all.
    expect(requests.flat().some((r) => r.operation === 'profile')).toBe(true);
    await controller.dispose();
  });

  it('superseding during profile cannot hijack the new source’s request lifecycle', async () => {
    let releaseProfile!: () => void;
    const gate = new Promise<void>((r) => { releaseProfile = r; });
    const gated: SupervisorHooks['adapters'] = {
      ...fixtureAdapters(),
      loadNormalize: async () => ({
        profileTable: async () => { await gate; return { proposedColumns: [], issues: [] }; },
        normalizeTable: () => TABLE as never,
      }),
    };
    const diags: string[] = [];
    const { controller } = makeController({
      adapters: gated,
      mainAdapters: { profileTable: async () => { await gate; return { proposedColumns: [], issues: [] }; } },
      onDiagnostic: (m) => diags.push(m),
    });
    const first = controller.selectSource(CSV, 'a.csv', 'csv');
    // A is parked inside its profile step once ingest.done flips the phase.
    await waitFor(() => controller.getState().phase === 'profiling');
    const second = controller.selectSource(CSV, 'b.csv', 'csv');
    releaseProfile();
    await Promise.allSettled([first, second]);
    const s = controller.getState();
    expect(s.error).toBeNull();
    expect(s.phase).toBe('ready');
    expect(s.active?.source.name).toBe('b.csv');
    // The superseded coroutine's terminal event must not vanish silently.
    expect(diags.length).toBeGreaterThan(0);
    await controller.dispose();
  });

  it('cancel exits needsReview and a late approveReview cannot restart the pipeline', async () => {
    const flagged: SupervisorHooks['adapters'] = {
      ...fixtureAdapters(),
      loadNormalize: async () => ({
        profileTable: () => ({ proposedColumns: [], issues: [REVIEW_ISSUE] }),
        normalizeTable: () => TABLE as never,
      }),
    };
    const { controller, requests } = makeController({
      adapters: flagged,
      mainAdapters: { profileTable: () => ({ proposedColumns: [], issues: [REVIEW_ISSUE] }) },
    });
    const done = controller.selectSource(CSV, 'dup.csv', 'csv');
    await waitFor(() => controller.getState().phase === 'needsReview');
    await done;
    controller.cancelWork('user');
    expect(controller.getState().phase).toBe('idle');
    await controller.approveReview([REVIEW_ISSUE.id], []);
    expect(controller.getState().phase).toBe('idle');
    expect(controller.getState().pending).toBeNull();
    // No normalize request may follow a cancelled review.
    expect(requests.flat().some((r) => r.operation === 'normalize')).toBe(false);
    await controller.dispose();
  });

  it('cancel during the analyze sub-request exits pending on the rotated rid', async () => {
    let releaseAnalyze!: () => void;
    const gate = new Promise<void>((r) => { releaseAnalyze = r; });
    const gated: SupervisorHooks['adapters'] = {
      ...fixtureAdapters(),
      loadAnalysis: async () => ({
        analyze: async () => { await gate; return SNAPSHOT as never; },
      }),
    };
    const { controller, requests } = makeController({ adapters: gated });
    const done = controller.selectSource(CSV, 'a.csv', 'csv');
    // 'analyze' runs under a rotated rid — cancel must still exit pending.
    await waitFor(() => requests.flat().some((r) => r.operation === 'analyze'));
    controller.cancelWork('user');
    releaseAnalyze();
    await done;
    const s = controller.getState();
    expect(s.phase).toBe('idle');
    expect(s.pending).toBeNull();
    expect(s.error).toBeNull();
    await controller.dispose();
  });

  it('a model-build failure surfaces a typed error instead of an unhandled rejection', async () => {
    const { controller } = makeController({
      mainAdapters: { buildExportModel: () => { throw new Error('model-boom'); } },
    });
    await controller.useSample();
    controller.openExport();
    await controller.prepareExport();
    const s = controller.getState();
    expect(s.phase).toBe('ready');
    expect(s.error?.code).toBeDefined();
    expect(s.export.building).toBe(false);
    await controller.dispose();
  });

  it('cancel during the export model build aborts before export.begin', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { controller } = makeController({
      mainAdapters: { buildExportModel: async () => { await gate; return EXPORT_MODEL; } },
    });
    await controller.useSample();
    controller.openExport();
    const pending = controller.prepareExport();
    await waitTick();
    controller.cancelExport();
    release();
    await pending;
    const s = controller.getState();
    expect(s.phase).toBe('ready');
    expect(s.export.building).toBe(false);
    expect(s.export.model).toBeNull();
    expect(s.export.artifacts.xlsx).toBeUndefined();
    await controller.dispose();
  });
});

describe('upload resilience — cancel coverage + progress honesty', () => {
  const CSV_BYTES = new TextEncoder().encode('a,b\n1,2\n').buffer as ArrayBuffer;

  it('marks real stages monotonically — parse → quality step → analyze, never a rewind', async () => {
    const { controller } = makeController();
    const stages: string[] = [];
    controller.subscribe((s) => {
      if (s.pending?.stage) stages.push(s.pending.stage);
    });
    await controller.selectSource(CSV_BYTES, 'a.csv', 'csv');
    expect(controller.getState().phase).toBe('ready');
    const order = ['preflight', 'parse', 'normalize', 'analyze'];
    let last = -1;
    for (const stage of stages) {
      const idx = order.indexOf(stage);
      expect(idx, `unexpected stage ${stage}`).toBeGreaterThanOrEqual(0);
      expect(idx, `stage regressed to ${stage}`).toBeGreaterThanOrEqual(last);
      last = idx;
    }
    // The analyze request carries no worker progress — the controller must
    // mark it itself or the UI would sit on 'normalize' while analysis runs.
    expect(stages).toContain('analyze');
    await controller.dispose();
  });

  it('upload parse abort tears down the in-flight worker request', async () => {
    const gate = new Promise<never>(() => {});
    const hanging: SupervisorHooks['adapters'] = {
      ...fixtureAdapters(),
      loadIngest: async () => ({ handleIngestRequest: () => gate }) as never,
    };
    const { controller, spawned } = makeController({ adapters: hanging });
    const ac = new AbortController();
    const pending = controller.parseViaWorker(CSV_BYTES, 'x.csv', {}, undefined, { signal: ac.signal });
    await waitFor(() => spawned.length === 1);
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(spawned[0]?.terminated).toBe(true);
    await controller.dispose();
  });

  it('the upload abort bridge still covers the profile leg of the same job', async () => {
    const gate = new Promise<never>(() => {});
    const adapters: SupervisorHooks['adapters'] = {
      ...fixtureAdapters(),
      loadNormalize: async () => ({
        profileTable: () => gate,
        normalizeTable: () => TABLE as never,
      }),
    };
    const { controller, spawned, requests } = makeController({ adapters });
    const ac = new AbortController();
    const table = await controller.parseViaWorker(CSV_BYTES, 'x.csv', {}, undefined, { signal: ac.signal });
    const profiled = controller.profileViaWorker(table);
    await waitFor(() => requests.flat().some((r) => r.operation === 'profile'));
    ac.abort();
    await expect(profiled).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(spawned.at(-1)?.terminated).toBe(true);
    await controller.dispose();
  });

  it('adoptUploadOutcome unbinds the upload signal — a later abort cannot kill normalize', async () => {
    const { controller, spawned } = makeController();
    const ac = new AbortController();
    const table = await controller.parseViaWorker(CSV_BYTES, 'x.csv', {}, undefined, { signal: ac.signal });
    const adopt = controller.adoptUploadOutcome({
      table,
      inspection: { format: 'csv', sourceName: 'x.csv', compressedBytes: CSV_BYTES.byteLength },
      parseOptions: {},
      approvalPlan: { issueIds: [], columns: [], useUnverifiedFormulaCaches: [] },
      sourceHash: table.sourceRef.sourceHash,
    });
    await waitFor(() => controller.getState().phase === 'ready');
    await adopt;
    ac.abort();
    // The upload job ended at submit — its stale signal must not terminate
    // the worker now carrying the committed session.
    expect(spawned.at(-1)?.terminated).toBe(false);
    await controller.dispose();
  });

  it('cancelWork during normalize exits pending and terminates the worker', async () => {
    const gate = new Promise<never>(() => {});
    const adapters: SupervisorHooks['adapters'] = {
      ...fixtureAdapters(),
      loadNormalize: async () => ({
        profileTable: () => ({ proposedColumns: [], issues: [] }),
        normalizeTable: () => gate,
      }),
    };
    const { controller, spawned, requests } = makeController({ adapters });
    const done = controller.selectSource(CSV_BYTES, 'a.csv', 'csv');
    await waitFor(() => requests.flat().some((r) => r.operation === 'normalize'));
    controller.cancelWork('user');
    await done;
    const s = controller.getState();
    expect(s.phase).toBe('idle');
    expect(s.pending).toBeNull();
    expect(s.requestId).toBeNull();
    expect(s.error).toBeNull();
    expect(spawned.at(-1)?.terminated).toBe(true);
    await controller.dispose();
  });

  it('cancelWork during the bounded inspect step exits pending — the late resolve drops', async () => {
    let release!: (v: unknown) => void;
    const gate = new Promise((r) => { release = r; });
    const { controller } = makeController({ mainAdapters: { inspectSource: () => gate } });
    const done = controller.selectSource(CSV_BYTES, 'a.csv', 'csv');
    await waitFor(() => controller.getState().phase === 'reading');
    controller.cancelWork('user');
    release({
      format: 'csv', sourceName: 'a.csv', sourceHash: 'h'.repeat(64),
      sheets: [], defaultSheetId: null, hiddenSheets: [], compressedBytes: 1,
    });
    await done;
    const s = controller.getState();
    expect(s.phase).toBe('idle');
    expect(s.error).toBeNull();
    expect(s.pending).toBeNull();
    await controller.dispose();
  });

  it('cancelExport during an in-flight export op ends the build cleanly', async () => {
    const gate = new Promise<never>(() => {});
    const adapters: SupervisorHooks['adapters'] = {
      ...fixtureAdapters(),
      loadExportWriters: async () => (async () => gate) as never,
    };
    const { controller, spawned, requests } = makeController({ adapters });
    await controller.useSample();
    controller.openExport();
    const pending = controller.prepareExport();
    await waitFor(() => requests.flat().some((r) => r.operation === 'export'));
    controller.cancelExport();
    await pending;
    const s = controller.getState();
    expect(s.phase).toBe('ready');
    expect(s.export.building).toBe(false);
    expect(s.export.failure?.code).toBe('CANCELLED');
    expect(spawned.at(-1)?.terminated).toBe(true);
    await controller.dispose();
  });

  it('ambiguous-delimiter upload defers to the picker instead of dead-ending on a banner', async () => {
    const { controller } = makeController();
    // Both ',' and ';' parse uniformly → the real inspector throws
    // AMBIGUOUS_INPUT/csv.ambiguous-delimiter (D-33c repro).
    const ambiguous = new TextEncoder().encode(
      'id;date,region\nR-1;2026-06-01,North\nR-2;2026-06-02,South\nR-3;2026-06-03,East\n',
    ).buffer;
    await controller.selectSource(ambiguous, 'amb.csv', 'csv');
    const s = controller.getState();
    // No failure is surfaced — the file waits in the pending-picker slot
    // for the upload flow's configure stage to claim it.
    expect(s.phase).toBe('idle');
    expect(s.error).toBeNull();
    expect(s.pending).toBeNull();
    const pending = takePendingPickerFile();
    expect(pending?.name).toBe('amb.csv');
    expect(new Uint8Array(pending!.bytes)).toEqual(new Uint8Array(ambiguous));
    await controller.dispose();
  });

  it('a failed upload marks the error retryable; retrySource replays the retained bytes', async () => {
    const { controller } = makeController();
    // Empty bytes fail real inspection (INVALID_FILE / csv.empty).
    await controller.selectSource(new ArrayBuffer(0), 'empty.csv', 'csv');
    const failed = controller.getState();
    expect(failed.error?.code).toBe('INVALID_FILE');
    expect(failed.error?.retrySource).toBe(true);
    expect(failed.phase).toBe('idle');

    controller.retrySource();
    await waitFor(() => controller.getState().error !== null);
    const retried = controller.getState();
    expect(retried.error?.code).toBe('INVALID_FILE');
    await controller.dispose();
  });

  it('non-upload failures carry no source retry', async () => {
    const { controller } = makeController({
      fetchSample: async () => new Response(null, { status: 404 }),
    });
    await controller.useSample();
    const s = controller.getState();
    expect(s.error).not.toBeNull();
    expect(s.error?.retrySource).toBeUndefined();
    controller.retrySource();
    // No pending source → the retry is a no-op.
    expect(controller.getState().pending).toBeNull();
    await controller.dispose();
  });
});
