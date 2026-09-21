import { Button, Dialog, Status } from '@rowfolio/ui';
import type { MessageKey } from '@rowfolio/i18n';
import { useI18n, useServices, useSessionState } from '../app/context.tsx';
import { formatInteger } from '../workspace/format.ts';
import type { ExportFormat } from '../app/state.ts';
import { SlideGlyph } from './slide-glyphs.tsx';
import './export.css';

/** Hashed filenames stay legible by the middle — head … tail, never a flood. */
function truncateMiddle(value: string, head = 30, tail = 14): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

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
                <span className="rf-export-link__meta" dir="ltr" title={entry.artifact.filename}>
                  {truncateMiddle(entry.artifact.filename)} · {formatInteger(i18n, entry.artifact.byteLength)} B · sha256 {entry.artifact.sha256.slice(0, 12)}…
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
