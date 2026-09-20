import type { ReactElement } from 'react';
import { Button, Dialog, Status } from '@rowfolio/ui';
import type { MessageKey } from '@rowfolio/i18n';
import type { ExportModel } from '@rowfolio/contracts';
import { useI18n, useServices, useSessionState } from '../app/context.tsx';
import { formatInteger } from '../workspace/format.ts';
import type { ExportFormat } from '../app/state.ts';
import './export.css';

const FORMAT_LABEL: Record<ExportFormat, MessageKey> = {
  xlsx: 'action.saveWorkbook' as MessageKey,
  pptx: 'action.saveDeck' as MessageKey,
};

/**
 * Export preparation dialog — explicitly started by the user. Shows the
 * briefing MODEL preview (slide/sheet plan, never a pixel render), build
 * progress per stage, then download links bound to the committed scenario +
 * locale captured at prepare time. A partial failure keeps completed links.
 */
export function ExportDialog() {
  const i18n = useI18n();
  const { controller } = useServices();
  const state = useSessionState();
  const ex = state.export;

  return (
    <Dialog
      open={ex.open}
      onClose={() => controller.closeExport()}
      title={i18n.tSafe('export.title' as MessageKey)}
      closeLabel={i18n.tSafe('action.close' as MessageKey)}
      footer={
        ex.building ? (
          <Button variant="secondary" onClick={() => controller.cancelExport()}>
            {i18n.tSafe('action.cancel' as MessageKey)}
          </Button>
        ) : undefined
      }
    >
      <ModelPreview state={state} />
      {ex.building && <Status kind="loading" title={i18n.tSafe(`export.${ex.stage ?? 'package'}` as MessageKey)} />}
      {ex.failure && (
        <div className="rf-banner rf-banner-error" role="alert">
          {i18n.tSafe(ex.failure.messageKey as MessageKey)}
        </div>
      )}
      {/*
        A model-build failure lands on `state.error` (request.failed) before
        `export.begin` — the session banner renders it behind this modal, so
        the dialog would otherwise look silently empty. While the requestId
        is held the build is still running and a stale error stays hidden.
      */}
      {!ex.building && state.requestId === null && state.error !== null && (
        <div className="rf-banner rf-banner-error" role="alert">
          {i18n.tSafe(state.error.messageKey as MessageKey)}
        </div>
      )}
      {!ex.building && (ex.artifacts.xlsx || ex.artifacts.pptx) && (
        <div className="rf-export-links">
          <p>{i18n.tSafe('export.ready' as MessageKey)}</p>
          {(['xlsx', 'pptx'] as const).map((format) => {
            const entry = ex.artifacts[format];
            if (!entry) return null;
            return (
              <div key={format} className="rf-export-link">
                <a href={entry.url} download={entry.artifact.filename} className="rf-download">
                  {i18n.tSafe(FORMAT_LABEL[format])}
                </a>
                <span className="rf-quiet" dir="ltr">
                  {entry.artifact.filename} · {formatInteger(i18n, entry.artifact.byteLength)} B · sha256 {entry.artifact.sha256.slice(0, 12)}…
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}

/** Model preview — slide + sheet outline only; labeled as model preview. */
function ModelPreview({ state }: { state: ReturnType<typeof useSessionState> }) {
  const i18n = useI18n();
  const model = state.export.model;
  return (
    <div className="rf-export-preview">
      <p className="rf-evidence-label">{i18n.tSafe('export.preview' as MessageKey)}</p>
      <p className="rf-quiet">{i18n.tSafe('export.previewNote' as MessageKey)}</p>
      {state.export.scenarioId && (
        <p className="rf-quiet">
          {i18n.tSafe('export.includesScenario' as MessageKey, {
            change: state.scenario ? i18n.formatPercent(state.scenario.costChange) : '',
          })}
        </p>
      )}
      <p className="rf-quiet">
        {i18n.tSafe('export.locale' as MessageKey)}: {i18n.localeName(state.export.locale ?? i18n.getState().locale)}
      </p>
      {model && (
        <>
          <ol className="rf-export-outline">
            {model.slides.map((slide) => (
              <li key={slide.id} className="rf-export-slide" data-kind={slide.kind}>
                <SlideGlyph kind={slide.kind} />
                <span className="rf-export-slide__meta">
                  <span className="rf-slide-kind">{slide.kind}</span>
                  <span className="rf-export-slide__title">{slide.title}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="rf-quiet" dir="ltr">
            {model.sheets.map((s) => s.name).join(' · ')}
          </p>
        </>
      )}
    </div>
  );
}

type SlideKind = ExportModel['slides'][number]['kind'];

/**
 * Per-kind slide composition — a recognizable mini layout for each slide
 * kind in the briefing model (decorative; the kind label carries the name).
 * All marks are token colors: cobalt = observed data, amber = the scenario
 * assumption, vermilion = the gap, teal = verified, ink = verdict/body.
 */
function SlideGlyph({ kind }: { kind: SlideKind }): ReactElement {
  return (
    <svg className="rf-export-slide__art" viewBox="0 0 96 64" aria-hidden="true" focusable="false">
      {SLIDE_ART[kind]}
    </svg>
  );
}

const SLIDE_ART: Record<SlideKind, ReactElement> = {
  /* Cover: ink masthead rule, headline block, cobalt folio bar. */
  summary: (
    <>
      <rect x="10" y="10" width="22" height="3" fill="var(--rf-data)" />
      <rect x="10" y="17" width="56" height="9" fill="var(--rf-ink)" />
      <rect x="10" y="30" width="76" height="2" fill="var(--rf-rule)" />
      <rect x="10" y="36" width="64" height="2" fill="var(--rf-rule)" />
      <rect x="10" y="42" width="70" height="2" fill="var(--rf-rule)" />
      <rect x="10" y="52" width="30" height="4" fill="var(--rf-data)" />
    </>
  ),
  /* KPI wall: three ruled cells each carrying a cobalt figure bar. */
  kpis: (
    <>
      {[8, 36, 64].map((x) => (
        <g key={x}>
          <rect x={x} y="12" width="24" height="40" fill="none" stroke="var(--rf-rule)" />
          <rect x={x + 4} y="18" width="10" height="3" fill="var(--rf-text-muted)" />
          <rect x={x + 4} y="26" width="16" height="8" fill="var(--rf-data)" />
          <rect x={x + 4} y="40" width="12" height="2" fill="var(--rf-rule)" />
          <rect x={x + 4} y="45" width="8" height="2" fill="var(--rf-positive)" />
        </g>
      ))}
    </>
  ),
  /* Finding: cobalt bar run with the vermilion gap tick on the flag cell. */
  finding: (
    <>
      <rect x="12" y="40" width="14" height="12" fill="var(--rf-data)" />
      <rect x="32" y="34" width="14" height="18" fill="var(--rf-data)" />
      <rect x="52" y="24" width="14" height="28" fill="var(--rf-data)" />
      <rect x="72" y="14" width="14" height="38" fill="var(--rf-data-tint-30)" />
      <line x1="79" y1="10" x2="79" y2="52" stroke="var(--rf-attention)" strokeWidth="2" />
      <rect x="12" y="52" width="74" height="2" fill="var(--rf-ink)" />
    </>
  ),
  /* Scenario: solid cobalt observed bar + dashed amber assumption overlay. */
  scenario: (
    <>
      <rect x="14" y="16" width="44" height="10" fill="var(--rf-data)" />
      <rect x="14" y="38" width="52" height="10" fill="color-mix(in srgb, var(--rf-scenario) 22%, transparent)" stroke="var(--rf-scenario)" strokeWidth="1.5" strokeDasharray="4 3" />
      <rect x="14" y="14" width="2" height="36" fill="var(--rf-ink)" />
      <text x="60" y="24" fontSize="7" fill="var(--rf-text-muted)">base</text>
      <text x="68" y="46" fontSize="7" fill="var(--rf-scenario-text)">what-if</text>
    </>
  ),
  /* Quality: checklist — teal verified cells, one vermilion exception. */
  quality: (
    <>
      {[14, 30, 46].map((y, i) => (
        <g key={y}>
          <rect x="12" y={y} width="7" height="7" fill={i < 2 ? 'var(--rf-positive)' : 'none'} stroke={i < 2 ? 'var(--rf-positive)' : 'var(--rf-attention)'} strokeWidth="1.5" />
          <rect x="26" y={y + 1} width={i < 2 ? 56 : 40} height="4" fill={i < 2 ? 'var(--rf-rule)' : 'var(--rf-attention)'} />
        </g>
      ))}
    </>
  ),
  /* Descriptive: prose columns — two ruled text columns with a callout. */
  descriptive: (
    <>
      <rect x="10" y="12" width="36" height="3" fill="var(--rf-ink)" />
      <rect x="10" y="20" width="36" height="2" fill="var(--rf-rule)" />
      <rect x="10" y="26" width="36" height="2" fill="var(--rf-rule)" />
      <rect x="10" y="32" width="30" height="2" fill="var(--rf-rule)" />
      <rect x="10" y="38" width="36" height="2" fill="var(--rf-rule)" />
      <rect x="52" y="12" width="34" height="2" fill="var(--rf-rule)" />
      <rect x="52" y="18" width="34" height="2" fill="var(--rf-rule)" />
      <rect x="52" y="24" width="28" height="2" fill="var(--rf-rule)" />
      <rect x="52" y="30" width="34" height="2" fill="var(--rf-rule)" />
      <rect x="52" y="44" width="34" height="1.5" fill="var(--rf-ink)" />
      <rect x="52" y="48" width="22" height="2" fill="var(--rf-text-muted)" />
      <rect x="10" y="48" width="12" height="7" fill="none" stroke="var(--rf-data)" />
    </>
  ),
  /* Methodology: column rules + a ruled footnote with source ticks. */
  methodology: (
    <>
      {[16, 40, 64].map((x) => (
        <rect key={x} x={x} y="10" width="1.5" height="34" fill="var(--rf-ink)" />
      ))}
      <rect x="20" y="16" width="16" height="3" fill="var(--rf-rule)" />
      <rect x="44" y="16" width="16" height="3" fill="var(--rf-rule)" />
      <rect x="68" y="16" width="16" height="3" fill="var(--rf-rule)" />
      <rect x="16" y="50" width="68" height="1.5" fill="var(--rf-ink)" />
      <rect x="16" y="54" width="34" height="2" fill="var(--rf-text-muted)" />
      <rect x="54" y="54" width="20" height="2" fill="var(--rf-data)" />
    </>
  ),
};
