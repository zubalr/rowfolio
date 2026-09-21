import { Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Button, Dialog, Status } from '@rowfolio/ui';
import type { MessageKey } from '@rowfolio/i18n';
import { inspectSource } from '@rowfolio/ingest';
import { evaluateProof, readEvidencePage } from '@rowfolio/provenance';
import type { NormalizedTable } from '@rowfolio/contracts';
import { takeWorkspaceIntent, type IntentDownload } from '../landing/pendingUpload.ts';
import type { UploadPorts, UploadOutcome } from '../upload/index.ts';
import { useI18n, useServices, useSessionState } from '../app/context.tsx';
import type { SessionState } from '../app/state.ts';
import { resolveFeatures } from '../app/features.ts';
import { LanguageToggle } from '../app/Landing.tsx';
import { KpiStrip } from './KpiStrip.tsx';
import { FindingList } from './FindingList.tsx';
import { ChartStage } from './ChartStage.tsx';
import { ScenarioPanel } from './ScenarioPanel.tsx';
import { EvidencePanel } from './EvidencePanel.tsx';
import { ReviewPanel } from './ReviewPanel.tsx';
import { Plate } from './Plate.tsx';
import { ExportDialog } from '../briefing/ExportDialog.tsx';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import { formatScope } from '../evidence/model.ts';
import './workspace.css';

const STAGE_IDS = ['preflight', 'parse', 'normalize', 'analyze'] as const;
const STAGE_LABELS: Record<(typeof STAGE_IDS)[number], MessageKey> = {
  preflight: 'upload.drop' as MessageKey,
  parse: 'export.model' as MessageKey,
  normalize: 'quality.preview' as MessageKey,
  analyze: 'workspace.findings' as MessageKey,
};

function stageList(i18n: ReturnType<typeof useI18n>) {
  return STAGE_IDS.map((id) => ({ id, label: i18n.tSafe(STAGE_LABELS[id]) }));
}

/**
 * Workspace — masthead + phase-driven body. Phases:
 * reading/profiling/analyzing → staged Status; needsReview → approval panel;
 * ready/exporting → KPIs, findings, charts, scenario, evidence, export.
 */
export function WorkspaceScreen({ navigateLanding }: { navigateLanding: () => void }) {
  const i18n = useI18n();
  const { controller } = useServices();
  const state = useSessionState();
  const features = resolveFeatures();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [replaceCandidate, setReplaceCandidate] = useState<File | null>(null);

  const adoptFile = async (file: File) => {
    const bytes = await file.arrayBuffer();
    await controller.selectSource(bytes, file.name, /\.xlsx$/i.test(file.name) ? 'xlsx' : 'csv');
  };

  const [pendingDownload, setPendingDownload] = useState<IntentDownload | null>(null);
  const downloadKicked = useRef(false);

  // Claim the landing's one-shot intent: sample/guide → prepared-sample
  // pipeline; upload{file} → straight into the session (the file was already
  // user-picked on the landing). A sample intent may also carry a download
  // format — the landing's Download actions mean a real file, so the export
  // pipeline runs here once the session commits.
  useEffect(() => {
    const intent = takeWorkspaceIntent();
    if (intent === null) return;
    if (intent.kind === 'upload') void adoptFile(intent.file);
    else {
      if (intent.kind === 'sample' && intent.download !== undefined) {
        setPendingDownload(intent.download);
      }
      void controller.useSample();
    }
    // Mount-once: consumes the one-shot landing intent.
  }, []);

  // Once the sample session is committed, open the export dialog and run the
  // real pipeline — the visitor sees generation, not a silent redirect. Kicks
  // exactly once per claimed intent.
  useEffect(() => {
    if (pendingDownload === null || downloadKicked.current) return;
    if (state.phase !== 'ready') return;
    downloadKicked.current = true;
    controller.openExport();
    void controller.prepareExport();
  }, [pendingDownload, state.phase, controller]);

  // When the requested artifact's blob URL lands, fire the same download the
  // dialog's link performs. The dialog stays open so the other format and the
  // hashes remain one click away.
  useEffect(() => {
    if (pendingDownload === null) return;
    const entry = state.export.artifacts[pendingDownload];
    if (entry === undefined || entry.url === '') return;
    const anchor = document.createElement('a');
    anchor.href = entry.url;
    anchor.download = entry.artifact.filename;
    anchor.rel = 'noopener';
    anchor.click();
    setPendingDownload(null);
  }, [pendingDownload, state.export.artifacts]);

  // UploadFlow ports: inspect runs in-process (bounded preview); parse and
  // profile are delegated to the analysis worker — the raw table it retains
  // is the same one profile and normalize resolve by id, and profiling stays
  // off the main thread.
  const uploadPorts: UploadPorts = useMemo(
    () => ({
      inspect: (bytes, name, options, progress) => inspectSource(bytes, name, options, progress),
      parse: (bytes, name, options, progress, extras) =>
        controller.parseViaWorker(bytes, name, options, progress, extras),
      profile: (raw) => controller.profileViaWorker(raw),
    }),
    [controller],
  );

  // A committed session is never silently replaced: with an active session
  // the picked file waits behind an explicit confirmation.
  const receiveFile = (file: File) => {
    if (state.active) setReplaceCandidate(file);
    else void adoptFile(file);
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) receiveFile(file);
  };

  const busy = state.phase === 'reading' || state.phase === 'profiling' || state.phase === 'analyzing' || state.phase === 'exporting';

  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <div className="rf-workspace">
      <header className="rf-masthead">
        <button type="button" className="rf-brand rf-brand-btn" onClick={navigateLanding}>
          {i18n.tSafe('brand.name' as MessageKey)}
        </button>
        <nav className="rf-mastnav">
          <Button
            variant="secondary"
            icon="upload"
            onClick={() => {
              if (state.phase === 'idle' && features.UploadFlow) {
                // Focus the mounted upload surface rather than opening a
                // parallel picker — one upload path, one review UX.
                const drop = document.querySelector<HTMLElement>('[data-testid="upload-dropzone"] input[type="file"], .rf-upload input[type="file"]');
                drop?.focus();
                drop?.click();
              } else {
                fileRef.current?.click();
              }
            }}
            disabled={busy}
          >
            {i18n.tSafe('action.upload' as MessageKey)}
          </Button>
          {state.phase === 'ready' && (
            <>
              <Button
                variant="primary"
                icon="download"
                onClick={() => {
                  controller.openExport();
                  void controller.prepareExport();
                }}
                data-testid="export-prepare-btn"
              >
                {i18n.tSafe('action.prepare' as MessageKey)}
              </Button>
              <button type="button" className="rf-linkbtn" onClick={() => controller.replay()}>
                {i18n.tSafe('action.replay' as MessageKey)}
              </button>
            </>
          )}
          <button
            type="button"
            className="rf-linkbtn"
            onClick={() => void controller.clearSession().then(navigateLanding)}
            data-testid="clear-session-btn"
          >
            {i18n.tSafe('action.clear' as MessageKey)}
          </button>
          <LanguageToggle />
        </nav>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={(e) => void onFile(e)}
        />
      </header>

      <SessionBanner state={state} />

      <main className="rf-workspace-main">
        <PhaseBody state={state} uploadPorts={uploadPorts} />
      </main>

      <EvidenceHost />
      <ExportDialog />
      <Dialog
        open={replaceCandidate !== null}
        onClose={() => setReplaceCandidate(null)}
        title={i18n.tSafe('upload.title' as MessageKey)}
        closeLabel={i18n.tSafe('action.cancel' as MessageKey)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReplaceCandidate(null)}>
              {i18n.tSafe('action.cancel' as MessageKey)}
            </Button>
            <Button
              variant="primary"
              icon="upload"
              onClick={() => {
                const file = replaceCandidate;
                setReplaceCandidate(null);
                if (file) void adoptFile(file);
              }}
              data-testid="confirm-replace-btn"
            >
              {i18n.tSafe('action.upload' as MessageKey)}
            </Button>
          </>
        }
      >
        <p>{i18n.tSafe('upload.previousRetained' as MessageKey)}</p>
      </Dialog>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}

function SessionBanner({ state }: { state: SessionState }) {
  const i18n = useI18n();
  const { controller } = useServices();
  if (state.error) {
    return (
      <div className="rf-banner rf-banner-error" role="alert">
        <span className="rf-banner__text">
          {i18n.tSafe(state.error.messageKey as MessageKey)}
          {state.notice ? ` · ${i18n.tSafe('upload.previousRetained' as MessageKey)}` : ''}
        </span>
        <span className="rf-banner__actions">
          {state.error.retrySource === true ? (
            <Button variant="secondary" onClick={() => controller.retrySource()} data-testid="banner-retry">
              {i18n.tSafe('action.retry' as MessageKey)}
            </Button>
          ) : null}
          <button type="button" className="rf-linkbtn" onClick={() => controller.cancelWork('user')} data-testid="banner-back">
            {i18n.tSafe('action.back' as MessageKey)}
          </button>
        </span>
      </div>
    );
  }
  if (state.notice) {
    return <div className="rf-banner">{i18n.tSafe('upload.previousRetained' as MessageKey)}</div>;
  }
  return null;
}

/** Evidence host — real EvidenceDialog when the evidence slot is present,
 *  bound to the merged provenance services; built-in panel otherwise. */
function EvidenceHost() {
  const i18n = useI18n();
  const { controller } = useServices();
  const state = useSessionState();
  const Slot = resolveFeatures().EvidenceDialog;
  const active = state.active;
  if (!Slot || !active || !state.evidenceFindingId) {
    return <EvidencePanel />;
  }
  return (
    <Suspense fallback={null}>
      <Slot
        open={state.evidenceOpen}
        onClose={() => controller.closeEvidence()}
        bundle={{
          snapshot: active.snapshot,
          table: active.table as NormalizedTable,
          findingId: state.evidenceFindingId,
        }}
        services={{ evaluateProof, readEvidencePage }}
        i18n={i18n}
      />
    </Suspense>
  );
}

function PhaseBody({
  state,
  uploadPorts,
}: {
  state: SessionState;
  uploadPorts: UploadPorts;
}) {
  const i18n = useI18n();
  const { controller } = useServices();

  switch (state.phase) {
    case 'idle': {
      const UploadFlow = resolveFeatures().UploadFlow;
      if (UploadFlow) {
        return (
          <Suspense
            fallback={<Status kind="loading" title={i18n.tSafe('a11y.processing' as MessageKey)} />}
          >
            <UploadFlow
              i18n={i18n}
              ports={uploadPorts}
              onComplete={(outcome: UploadOutcome) => void controller.adoptUploadOutcome(outcome)}
            />
          </Suspense>
        );
      }
      return (
        <Plate
          index="01"
          name={i18n.tSafe('plate.upload' as MessageKey)}
          title={i18n.tSafe('workspace.title' as MessageKey)}
          headingLevel={1}
          className="rf-idle"
        >
          <p className="rf-quiet">{i18n.tSafe('upload.drop' as MessageKey)}</p>
          <div className="rf-idle-actions">
            <Button variant="primary" icon="table" onClick={() => void controller.useSample()} data-testid="open-demo-cta">
              {i18n.tSafe('action.tryDemo' as MessageKey)}
            </Button>
          </div>
        </Plate>
      );
    }

    case 'reading':
    case 'profiling':
    case 'analyzing':
      return (
        <Plate
          index="02"
          name={i18n.tSafe('plate.checks' as MessageKey)}
          title={i18n.tSafe('a11y.processing' as MessageKey)}
        >
          <Status
            kind="loading"
            title={i18n.tSafe('a11y.processing' as MessageKey)}
            stages={stageList(i18n)}
            currentStage={state.pending?.stage ?? 'preflight'}
            actions={
              <button type="button" className="rf-linkbtn" onClick={() => controller.cancelWork('user')}>
                {i18n.tSafe('action.cancel' as MessageKey)}
              </button>
            }
          />
        </Plate>
      );

    case 'needsReview':
      return <ReviewPanel />;

    case 'ready':
    case 'exporting': {
      const active = state.active;
      if (!active) return null;
      return (
        <>
          <header className="rf-workspace-head">
            <h1 className="rf-workspace-title">{i18n.tSafe('workspace.title' as MessageKey)}</h1>
            <p className="rf-quiet">
              <span dir="ltr">{active.source.name}</span>
            </p>
            <p className="rf-quiet rf-workspace-scope">
              {formatScope(i18n, active.snapshot.scope)}
            </p>
            <p className="rf-quiet">
              {i18n.tSafe('workspace.records' as MessageKey, {
                raw: String(active.snapshot.qualitySummary.rawRows),
                clean: String(active.snapshot.qualitySummary.retainedRows),
              })}
            </p>
          </header>
          <Plate
            index="03"
            name={i18n.tSafe('plate.findings' as MessageKey)}
            title={i18n.tSafe('workspace.findings' as MessageKey)}
            testId="findings-plate"
          >
            <KpiStrip snapshot={active.snapshot} />
            <FindingList snapshot={active.snapshot} />
            <ScenarioPanel />
          </Plate>
          <Plate
            index="03"
            name={i18n.tSafe('plate.findings' as MessageKey)}
            title={i18n.tSafe('workspace.overview' as MessageKey)}
            testId="overview-plate"
          >
            <ChartStage snapshot={active.snapshot} />
          </Plate>
          {state.phase === 'exporting' && (
            <Status
              kind="loading"
              title={i18n.tSafe('export.package' as MessageKey)}
              actions={
                <button type="button" className="rf-linkbtn" onClick={() => controller.cancelExport()}>
                  {i18n.tSafe('action.cancel' as MessageKey)}
                </button>
              }
            />
          )}
        </>
      );
    }

    default:
      return null;
  }
}
