import { useRef, useState, type ChangeEvent } from 'react';
import { Button, Dialog, Status } from '@rowfolio/ui';
import type { MessageKey } from '@rowfolio/i18n';
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
import { ExportDialog } from '../briefing/ExportDialog.tsx';

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
    <div className="rf-workspace">
      <header className="rf-masthead">
        <button type="button" className="rf-brand rf-brand-btn" onClick={navigateLanding}>
          {i18n.tSafe('brand.name' as MessageKey)}
        </button>
        <nav className="rf-mastnav">
          {features.UploadZone ? (
            <features.UploadZone onFile={receiveFile} />
          ) : (
            <Button variant="secondary" icon="upload" onClick={() => fileRef.current?.click()} disabled={busy}>
              {i18n.tSafe('action.upload' as MessageKey)}
            </Button>
          )}
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
              <Button variant="secondary" onClick={() => controller.replay()}>
                {i18n.tSafe('action.replay' as MessageKey)}
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            icon="close"
            onClick={() => void controller.clearSession().then(navigateLanding)}
            data-testid="clear-session-btn"
          >
            {i18n.tSafe('action.clear' as MessageKey)}
          </Button>
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
        <PhaseBody state={state} />
      </main>

      <EvidencePanel />
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
  );
}

function SessionBanner({ state }: { state: SessionState }) {
  const i18n = useI18n();
  if (state.error) {
    return (
      <div className="rf-banner rf-banner-error" role="alert">
        {i18n.tSafe(state.error.messageKey as MessageKey)}
        {state.notice ? ` · ${i18n.tSafe('upload.previousRetained' as MessageKey)}` : ''}
      </div>
    );
  }
  if (state.notice) {
    return <div className="rf-banner">{i18n.tSafe('upload.previousRetained' as MessageKey)}</div>;
  }
  return null;
}

function PhaseBody({ state }: { state: SessionState }) {
  const i18n = useI18n();
  const { controller } = useServices();

  switch (state.phase) {
    case 'idle':
      return (
        <section className="rf-idle">
          <h1 className="rf-idle-title">{i18n.tSafe('workspace.title' as MessageKey)}</h1>
          <p className="rf-quiet">{i18n.tSafe('upload.drop' as MessageKey)}</p>
          <div className="rf-idle-actions">
            <Button variant="primary" icon="table" onClick={() => void controller.useSample()} data-testid="open-demo-cta">
              {i18n.tSafe('action.tryDemo' as MessageKey)}
            </Button>
          </div>
        </section>
      );

    case 'reading':
    case 'profiling':
    case 'analyzing':
      return (
        <Status
          kind="loading"
          title={i18n.tSafe('a11y.processing' as MessageKey)}
          stages={stageList(i18n)}
          currentStage={state.pending?.stage ?? 'preflight'}
          actions={
            <Button variant="secondary" onClick={() => controller.cancelWork('user')}>
              {i18n.tSafe('action.cancel' as MessageKey)}
            </Button>
          }
        />
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
              {i18n.tSafe('workspace.records' as MessageKey, {
                raw: String(active.snapshot.qualitySummary.rawRows),
                clean: String(active.snapshot.qualitySummary.retainedRows),
              })}
              {' · '}
              <span dir="ltr">{active.source.name}</span>
            </p>
          </header>
          <KpiStrip snapshot={active.snapshot} />
          <FindingList snapshot={active.snapshot} />
          <ChartStage snapshot={active.snapshot} />
          <ScenarioPanel />
          {state.phase === 'exporting' && (
            <Status
              kind="loading"
              title={i18n.tSafe('export.package' as MessageKey)}
              actions={
                <Button variant="secondary" onClick={() => controller.cancelExport()}>
                  {i18n.tSafe('action.cancel' as MessageKey)}
                </Button>
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
