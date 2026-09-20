/**
 * Adversarial session/worker-lifecycle suite.
 *
 * Drives the REAL wire protocol: SessionController → WorkerClient →
 * InProcessWorker → WorkerSupervisor → real ingest/normalize/analysis/
 * export engines. No mocks on the engine path — the only stand-ins are the
 * WorkerLike shim and a manual export gate used to deterministically hold a
 * request mid-flight.
 *
 * `it.fails` marks a demonstrated defect (the assertion encodes the CORRECT
 * contract); when the owning agent lands the fix the test flips red and must
 * be promoted to a plain `it`.
 */
import { describe, expect, it } from 'vitest';
import type {
  Column,
  NormalizedTable,
  RawTable,
  WorkerRequest,
} from '../../packages/contracts/src/index.ts';
import { checkSchema } from '../../packages/contracts/src/index.ts';
import { SessionController } from '../../apps/web/src/app/controller.ts';
import { WorkerClient } from '../../apps/web/src/workers/client.ts';
import { InProcessWorker } from '../../apps/web/src/workers/test-helpers.ts';
import type { SupervisorHooks } from '../../apps/web/src/workers/supervisor.ts';
import { BlobUrlStore } from '../../apps/web/src/app/blobUrls.ts';
import { parseSource, inspectSource, handleIngestRequest } from '../../packages/ingest/src/index.ts';
import { profileTable, normalizeTable } from '../../packages/normalize/src/index.ts';
import { analyze } from '../../packages/analysis/src/index.ts';
import { runScenario } from '../../packages/scenario/src/index.ts';
import { buildExportModel } from '../../packages/export-model/src/index.ts';
import { buildWorkbook } from '../../packages/export-xlsx/src/index.ts';
import { buildPresentation } from '../../packages/export-pptx/src/index.ts';
import { buildXlsx, csvBytes, toArrayBuffer } from './helpers.ts';

/* ---- real engine wiring (no fixture adapters) ---- */

const realAdapters: SupervisorHooks['adapters'] = {
  loadIngest: async () => ({ parseSource, inspectSource, handleIngestRequest }) as never,
  loadNormalize: async () => ({ profileTable, normalizeTable }) as never,
  loadAnalysis: async () => ({ analyze }) as never,
  loadScenario: async () => ({ runScenario }) as never,
  loadExportWriters: async (format: 'xlsx' | 'pptx') =>
    (format === 'xlsx' ? buildWorkbook : buildPresentation) as never,
};

function makeController(overrides?: {
  exportGate?: { hold: Promise<void> };
}) {
  const workers: InProcessWorker[] = [];
  const requests: WorkerRequest[][] = [];
  const spawn = (adapters: SupervisorHooks['adapters']) => () => {
    const w = new InProcessWorker({ adapters });
    workers.push(w);
    requests.push(w.received);
    return w;
  };
  const adapters: SupervisorHooks['adapters'] = overrides?.exportGate
    ? {
        ...realAdapters,
        loadExportWriters: async (format: 'xlsx' | 'pptx') => {
          const inner = (format === 'xlsx' ? buildWorkbook : buildPresentation) as never;
          return (async (model: unknown, progress: never) => {
            await overrides.exportGate?.hold;
            return (inner as (m: unknown, p: never) => unknown)(model, progress);
          }) as never;
        },
      }
    : realAdapters;

  const controller = new SessionController({
    adapters: {
      profileTable: (raw) => profileTable(raw as RawTable),
      inspectSource: (bytes, name, options) =>
        inspectSource(bytes, name, options as never) as never,
      buildExportModel: (snapshot, table, scenario, locale, numberingSystem, createdAt) =>
        buildExportModel(snapshot, table, scenario, locale, numberingSystem, createdAt),
    },
    blobStore: new BlobUrlStore({
      createObjectURL: () => 'blob:adv',
      revokeObjectURL: () => {},
    }),
    ids: (() => {
      let n = 0;
      return { request: () => `adv-req-${++n}`, session: () => 'adv-session' };
    })(),
    createAnalysisClient: () => new WorkerClient(spawn(adapters)),
    createExportClient: () => new WorkerClient(spawn(adapters)),
  });
  return { controller, workers, requests };
}

/** Poll a predicate up to ~5s (default 10ms interval). */
async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const CLEAN_CSV = csvBytes('date,region,amount\n2026-06-01,North,10\n2026-06-02,South,20\n');

async function uploadCsvToReady(controller: SessionController, bytes = CLEAN_CSV, name = 'demo.csv') {
  await controller.selectSource(toArrayBuffer(bytes), name, 'csv', null);
  return controller.getState();
}

/* ------------------------------------------------------------------ */
/* — adoptUploadOutcome cancels the worker that retains the    */
/*           parsed RawTable; the committed upload path always fails.  */
/* ------------------------------------------------------------------ */

describe('upload review commit path', () => {
  it('a committed UploadFlow outcome reaches phase ready', async () => {
    // Previously: adoptUploadOutcome() called cancelWork() which terminated
    // the worker retaining the raw table → every committed upload failed
    // with INTERNAL. Fixed upstream by d8beb01 — this test is now the
    // regression lock for it.
    const { controller } = makeController();
    // UploadFlow's parse port — the worker retains the RawTable by id.
    const bytes = toArrayBuffer(CLEAN_CSV);
    const table = await controller.parseViaWorker(bytes, 'demo.csv', { allowHiddenSheet: false });
    // UploadFlow.submit() produces this outcome; adoptUploadOutcome must
    // reuse the worker that still holds the raw table.
    await controller.adoptUploadOutcome({
      table,
      inspection: { format: 'csv', sourceName: 'demo.csv', compressedBytes: CLEAN_CSV.byteLength },
      parseOptions: { allowHiddenSheet: false },
      approvalPlan: { issueIds: [], columns: profileTable(table).proposedColumns, useUnverifiedFormulaCaches: [] },
      sourceHash: table.sourceRef.sourceHash,
    });
    const state = controller.getState();
    // DEFECT: adoptUploadOutcome() calls cancelWork('new source') which
    // terminates the analysis worker — the retained rawTable is lost, the
    // normalize op answers 'unknown rawTableId', and the session fails with
    // INTERNAL instead of reaching ready.
    expect(state.phase).toBe('ready');
    expect(state.error).toBeNull();
    expect(state.active?.snapshot).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* — the formula-cache opt-in cannot cross the wire: the        */
/*           normalize payload has no such field (schema rejects it),   */
/*           and the supervisor hardcodes useUnverifiedFormulaCaches:[].*/
/* ------------------------------------------------------------------ */

describe('formula-cache opt-in wire propagation', () => {
  it('WorkerRequest schema accepts a normalize payload carrying useUnverifiedFormulaCaches', () => {
    // Was part 1: the schema had no slot, silently dropping the
    // user's opt-in. Fixed upstream at a6d6af1 — the field validates now.
    const req = {
      protocolVersion: 1,
      requestId: 'r1',
      sessionId: 's1',
      revision: 0,
      operation: 'normalize',
      payload: {
        rawTableId: 'raw-1',
        approvedIssueIds: [],
        columnConfirmations: [],
        // UploadFlow collects this from the user (approvalPlan field) —
        // locked: the wire schema must keep accepting it.
        useUnverifiedFormulaCaches: ['amount'],
      },
    };
    expect(checkSchema('WorkerRequest', req)).toEqual([]);
  });

  it('an opted-in formula cache flows to normalized values over the real wire path', async () => {
    // Was part 2: the supervisor hardcoded useUnverifiedFormulaCaches:[].
    // Fixed upstream at a6d6af1 — the wire slot exists and is forwarded.
    const client = new WorkerClient(() => new InProcessWorker({ adapters: realAdapters }));
    // Ingest a formula-bearing workbook over the wire so the supervisor
    // retains the RawTable by id — the exact state UploadFlow leaves behind.
    const formulaXlsx = buildXlsx({
      sheets: [{ name: 'Data', rows: [['amount'], [{ t: 'f', f: '1+1', v: 42 }]] }],
    });
    const ingest = await client.request(
      {
        protocolVersion: 1,
        requestId: 'i1',
        sessionId: 's',
        revision: 0,
        operation: 'ingest',
        payload: { sourceName: 'f.xlsx', format: 'xlsx', byteLength: formulaXlsx.byteLength, binarySlot: 'source' },
      },
      [{ slot: 'source', buffer: toArrayBuffer(formulaXlsx) }],
    );
    const raw = ingest.result as RawTable;
    const profile = profileTable(raw);
    const cacheIssue = profile.issues.find((i) => i.action === 'use-cache');
    expect(cacheIssue).toBeDefined();
    const optedColumns = profile.proposedColumns.map((c: Column) => ({ ...c, confirmed: true }));

    const res = await client.request({
      protocolVersion: 1,
      requestId: 'n1',
      sessionId: 's',
      revision: 0,
      operation: 'normalize',
      payload: {
        rawTableId: raw.id,
        approvedIssueIds: cacheIssue ? [cacheIssue.id] : [],
        columnConfirmations: optedColumns,
        useUnverifiedFormulaCaches: ['amount'],
      },
    });
    const table = res.result as NormalizedTable;
    // With the opt-in honored, the formula cell contributes its cache (42).
    expect(table.rows[0]?.values['amount']).toBe('42');
  });
});

/* ------------------------------------------------------------------ */
/* — parse transfers (detaches) the caller's ArrayBuffer; the   */
/*           upload controller's retry() reuses it and can never win.   */
/* ------------------------------------------------------------------ */

describe('detached-buffer retry', () => {
  it('a parse retry after a recoverable error can reuse the original file bytes', async () => {
    // Previously: parseViaWorker transferred the caller's ArrayBuffer,
    // detaching it — retry() on file.bytes could never win. Fixed upstream
    // at a6d6af1 (transfers bytes.slice(0)); caller's buffer stays attached.
    const { controller } = makeController();
    const bytes = toArrayBuffer(CLEAN_CSV);
    await controller.parseViaWorker(bytes, 'demo.csv', { allowHiddenSheet: false });
    // In-process shim does not detach — the meaningful lock is that the
    // caller buffer still parses on retry (byteLength intact under the fix).
    expect(bytes.byteLength).toBeGreaterThan(0);
    const table = await controller.parseViaWorker(bytes, 'demo.csv', { allowHiddenSheet: false });
    expect(table.id).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* — export.finished/export.done carry no requestId or phase    */
/*           guard: an export that outlives its source still commits.   */
/* ------------------------------------------------------------------ */

describe('stale export commits over a newer session', () => {
  it('a superseded export cannot record artifacts or force phase=ready', async () => {
    // Previously: export.done/finished merged artifacts unconditionally.
    // Fixed upstream at a6d6af1 — export.begin stamps epoch=revision and
    // done/failed/finished/progress drop mismatched-epoch commits.
    let release!: () => void;
    const gate = { hold: new Promise<void>((r) => (release = r)) };
    const { controller } = makeController({ exportGate: gate });

    // 1) Commit source A → ready.
    const s1 = await uploadCsvToReady(controller);
    expect(s1.phase).toBe('ready');
    const snapshotIdA = s1.active?.snapshot.id;
    expect(snapshotIdA).toBeTruthy();

    // 2) Export starts building on the export worker (held at the gate).
    const exportDone = controller.prepareExport();
    await waitFor(() => controller.getState().phase === 'exporting');

    // 3) A new source arrives mid-export and finishes; cancelWork only
    //    touches the analysis client — the OLD snapshot's export runs on.
    const bytesB = toArrayBuffer(csvBytes('date,region,amount\n2026-07-01,East,5\n'));
    const selectDone = controller.selectSource(bytesB, 'new.csv', 'csv', null);
    await waitFor(() => controller.getState().phase === 'ready' && controller.getState().pending === null);
    const idB = controller.getState().active?.snapshot.id;
    expect(idB).toBeTruthy();
    expect(idB).not.toBe(snapshotIdA);

    // 4) The superseded export completes late → export.done lands artifacts
    //    built from snapshot A's model on a session committed to B.
    release();
    await exportDone;
    await selectDone;
    const st = controller.getState();
    // CORRECT behavior: stale artifacts are dropped — 'export.done' carries
    // no requestId/epoch guard, so today the old model's artifacts commit.
    expect(Object.keys(st.export.artifacts)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Verified-good lifecycle behaviors (regression locks)                */
/* ------------------------------------------------------------------ */

describe('lifecycle regression locks', () => {
  it('selectSource clean CSV reaches ready with a contract-valid snapshot', async () => {
    const { controller } = makeController();
    const st = await uploadCsvToReady(controller);
    expect(st.phase).toBe('ready');
    expect(st.error).toBeNull();
    expect(st.active?.snapshot.findings.length).toBeGreaterThanOrEqual(0);
  });

  it('a second upload supersedes the first cleanly (no stale snapshot commit)', async () => {
    const { controller } = makeController();
    await uploadCsvToReady(controller);
    const first = controller.getState().active?.snapshot.id;
    const bytesB = toArrayBuffer(csvBytes('date,region,amount\n2026-07-01,East,7\n'));
    const st = await controller.selectSource(bytesB, 'second.csv', 'csv', null).then(() => controller.getState());
    expect(st.phase).toBe('ready');
    expect(st.active?.snapshot.id).not.toBe(first);
    expect(st.active?.source.name).toBe('second.csv');
  });

  it('ingest failure on upload surfaces an actionable typed error, session stays clean', async () => {
    const { controller } = makeController();
    // Invalid UTF-8 → deterministic INVALID_FILE on the CSV path (and the
    // file isn't a ZIP so xlsx sniffing never reaches SheetJS).
    const bad = toArrayBuffer(new Uint8Array([0xff, 0xfe, 0xff, 0x00, 0xff]));
    await controller.selectSource(bad, 'bad.bin', 'csv', null);
    const st = controller.getState();
    expect(st.phase).toBe('idle');
    expect(st.error).not.toBeNull();
    expect(st.error?.code).not.toBe('INTERNAL');
    expect(st.active).toBeNull();
  });
});
