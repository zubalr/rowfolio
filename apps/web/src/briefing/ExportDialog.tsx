import { useRef, useState, type KeyboardEvent } from 'react';
import { Dialog, Status } from '@rowfolio/ui';
import type { MessageKey } from '@rowfolio/i18n';
import { exportFileName, localizeDigits } from '@rowfolio/export-model';
import { useI18n, useServices, useSessionState } from '../app/context.tsx';
import { formatInteger } from '../workspace/format.ts';
import { PlateLabel } from '../workspace/Plate.tsx';
import type { ExportFormat } from '../app/state.ts';
import { SlidePreview, WorkbookPreview } from './SlidePreview.tsx';
import './export.css';

/** Hashed filenames stay legible by the middle — head … tail, never a flood. */
function truncateMiddle(value: string, head = 30, tail = 14): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Human size: `45120` → `44.1 KB`, `1200000` → `1.1 MB`. */
function formatBytes(i18n: ReturnType<typeof useI18n>, bytes: number): string {
  if (bytes >= 1_000_000) return `${i18n.formatNumber(bytes / 1_000_000, { maxFractionDigits: 1 })} MB`;
  if (bytes >= 1_000) return `${i18n.formatNumber(bytes / 1_000, { maxFractionDigits: 1 })} KB`;
  return `${i18n.formatInteger(bytes)} B`;
}

const FORMAT_LABEL: Record<ExportFormat, MessageKey> = {
  xlsx: 'action.saveWorkbook' as MessageKey,
  pptx: 'action.saveDeck' as MessageKey,
};

/**
 * Export preparation dialog — explicitly started by the user. Shows a
 * readable preview of the actual deliverables (each slide page composed
 * from the same ExportModel + copy tables the writers consume), build
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
      className="rf-dialog--export"
      footer={
        ex.building ? (
          <button type="button" className="rf-linkbtn" onClick={() => controller.cancelExport()}>
            {i18n.tSafe('action.cancel' as MessageKey)}
          </button>
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
                <span className="rf-export-link__meta" dir="ltr" title={entry.artifact.filename}>
                  {truncateMiddle(entry.artifact.filename)} · {formatBytes(i18n, entry.artifact.byteLength)}
                </span>
                <details className="rf-export-link__tech">
                  <summary>{i18n.tSafe('common.technicalDetails' as MessageKey)}</summary>
                  <span dir="ltr">
                    {entry.artifact.filename} · {formatInteger(i18n, entry.artifact.byteLength)} B · sha256 {entry.artifact.sha256.slice(0, 12)}…
                  </span>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}

/**
 * Deliverable preview — a tab-strip of slide thumbnails that are
 * NAVIGATION ONLY: selecting one fills the reading pane above with that
 * page at real reading size. Arrow keys move between thumbnails (roving
 * focus, automatic activation); the workbook sheet list rides as the
 * last thumbnail.
 */
function ModelPreview({ state }: { state: ReturnType<typeof useSessionState> }) {
  const i18n = useI18n();
  const model = state.export.model;
  const [selected, setSelected] = useState(0);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const total = (model?.slides.length ?? 0) + 1;
  const current = Math.min(selected, Math.max(0, total - 1));
  const workbookTab = current === total - 1;

  const activate = (index: number) => {
    setSelected(index);
    tabsRef.current[index]?.focus();
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const rtl = (model?.locale ?? i18n.getState().locale) === 'ar';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next: number | null = null;
    if (event.key === forward) next = (current + 1) % total;
    else if (event.key === back) next = (current - 1 + total) % total;
    else if (event.key === 'ArrowDown') next = (current + 1) % total;
    else if (event.key === 'ArrowUp') next = (current - 1 + total) % total;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = total - 1;
    if (next !== null) {
      event.preventDefault();
      activate(next);
    }
  };

  return (
    <div className="rf-export-preview">
      <PlateLabel index="04" name={i18n.tSafe('plate.report' as MessageKey)} />
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
        <div className="rf-export-stage">
          <div
            className="rf-export-pane"
            role="tabpanel"
            id="rf-export-pane"
            aria-labelledby={`rf-export-tab-${current}`}
            tabIndex={0}
          >
            {workbookTab ? (
              <WorkbookPreview model={model} className="rf-sp--pane" />
            ) : (
              <SlidePreview model={model} slide={model.slides[current]!} className="rf-sp--pane" />
            )}
          </div>
          <ol
            className="rf-export-outline"
            role="tablist"
            aria-label={i18n.tSafe('export.preview' as MessageKey)}
            onKeyDown={onTabKeyDown}
          >
            {model.slides.map((slide, index) => (
              <li key={slide.id}>
                <button
                  type="button"
                  role="tab"
                  id={`rf-export-tab-${index}`}
                  aria-selected={index === current}
                  aria-controls="rf-export-pane"
                  tabIndex={index === current ? 0 : -1}
                  className={`rf-export-pick${index === current ? ' rf-export-pick--on' : ''}`}
                  aria-label={`${slide.title} · ${localizeDigits(`${index + 1}/${model.slides.length + 1}`, model.numberingSystem)}`}
                  onClick={() => setSelected(index)}
                  ref={(el) => { tabsRef.current[index] = el; }}
                >
                  <SlidePreview model={model} slide={slide} nav />
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                role="tab"
                id={`rf-export-tab-${model.slides.length}`}
                aria-selected={workbookTab}
                aria-controls="rf-export-pane"
                tabIndex={workbookTab ? 0 : -1}
                className={`rf-export-pick${workbookTab ? ' rf-export-pick--on' : ''}`}
                aria-label={exportFileName(model, 'xlsx')}
                onClick={() => setSelected(model.slides.length)}
                ref={(el) => { tabsRef.current[model.slides.length] = el; }}
              >
                <WorkbookPreview model={model} />
              </button>
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
