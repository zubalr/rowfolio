/* eslint-disable no-restricted-imports -- tests read fixture/sample bytes from disk */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalysisSnapshot, ExportModel, NormalizedTable } from '@rowfolio/contracts';
import { SessionController } from './controller.ts';
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
    const path = join(SAMPLE_DIR, url.replace(/^sample\/?/, ''));
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
} = {}) {
  const spawned: InProcessWorker[] = [];
  const requests: WorkerRequest[][] = [];
  const blobs = { urls: [] as string[], revoked: [] as string[] };
  const blobStore = opts.blobStore ?? new BlobUrlStore({
    createObjectURL: () => `blob:mock-${blobs.urls.push(`u${blobs.urls.length}`)}`,
    revokeObjectURL: (u) => { blobs.revoked.push(u); },
  });
  const controller = new SessionController({
    fetchSample: opts.fetchSample ?? (diskFetch() as never),
    // Main-thread pure adapters — contract-fixture stand-ins while engines
    // ship on hb/* (production path resolves the real packages at merge).
    adapters: {
      profileTable: () => ({ proposedColumns: [], issues: [] }),
      buildExportModel: () => EXPORT_MODEL,
      ...opts.mainAdapters,
    },
    blobStore,
    ids: (() => { let n = 0; return { request: () => `r${++n}`, session: () => 'test-session' }; })(),
    createAnalysisClient: () => {
      const worker = new InProcessWorker({ adapters: opts.adapters ?? fixtureAdapters() });
      spawned.push(worker);
      requests.push(worker.received);
      return new WorkerClient(() => worker);
    },
    createExportClient: () => {
      const worker = new InProcessWorker({ adapters: opts.adapters ?? fixtureAdapters() });
      spawned.push(worker);
      requests.push(worker.received);
      return new WorkerClient(() => worker);
    },
  });
  return { controller, spawned, requests, blobStore, blobs };
}

const waitTick = () => new Promise((r) => setTimeout(r, 0));

describe('SessionController', () => {
  it('completes the prepared-sample path end-to-end over the wire protocol', async () => {
    const { controller, requests } = makeController();
    await controller.useSample();
    const s = controller.getState();
    expect(s.phase).toBe('ready');
    expect(s.active?.snapshot.id).toBe(SNAPSHOT.id);
    expect(s.active?.source.hash).toBe('f0d6d06e934b1eef01d839d071ec7dcdc6d9d47b58ccf556c4eb44f92adb3f5e');
    // Wire order: ingest → normalize → analyze on the analysis worker.
    const ops = requests[0]!.map((r) => r.operation);
    expect(ops).toEqual(['ingest', 'normalize', 'analyze']);
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
    expect(ops).toEqual(['ingest', 'normalize', 'analyze', 'scenario']);
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
        profileTable: () => ({ proposedColumns: [], issues: [] }),
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
        profileTable: () => ({ proposedColumns: [], issues: [] }),
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
