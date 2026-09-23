/**
 * Report viewer — the shared preview surface: one substantial reading pane
 * showing the selected deliverable at real size, plus a thumbnail rail that
 * is NAVIGATION ONLY. Arrow keys move between thumbnails (roving focus,
 * automatic activation, RTL-aware); the workbook sheet list rides as the
 * last thumbnail. Activating a thumbnail reveals the pane (`scrollIntoView`)
 * so the selected content is always on screen.
 *
 * Consumed by the export dialog and by landing (`ReportViewer` props are the
 * agreed lane-A interface — keep them narrow and stable).
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ExportModel } from '@rowfolio/contracts';
import { exportFileName, localizeDigits } from '@rowfolio/export-model';
import { useI18n } from '../app/context.tsx';
import type { MessageKey } from '@rowfolio/i18n';
import { SlidePreview, WorkbookPreview } from './SlidePreview.tsx';
import './report-viewer.css';

export interface ReportViewerProps {
  model: ExportModel;
  className?: string;
}

export function ReportViewer({ model, className }: ReportViewerProps) {
  const i18n = useI18n();
  const [selected, setSelected] = useState(0);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const paneId = `${baseId}-pane`;
  const tabId = (index: number) => `${baseId}-tab-${index}`;

  const total = model.slides.length + 1;
  const current = Math.min(selected, Math.max(0, total - 1));
  const workbookTab = current === total - 1;

  const activate = (index: number, moveFocus: boolean) => {
    setSelected(index);
    if (moveFocus) tabsRef.current[index]?.focus();
    // The rail may sit below the scrollport on long pages — always reveal
    // the pane so the selected deliverable is on screen.
    paneRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const rtl = model.locale === 'ar';
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
      activate(next, true);
    }
  };

  return (
    <div className={`rf-rv${className ? ` ${className}` : ''}`}>
      <div
        className="rf-rv__pane"
        role="tabpanel"
        id={paneId}
        aria-labelledby={tabId(current)}
        tabIndex={0}
        ref={paneRef}
      >
        {workbookTab ? (
          <WorkbookPreview model={model} className="rf-sp--pane" />
        ) : (
          <SlidePreview model={model} slide={model.slides[current]!} className="rf-sp--pane" />
        )}
      </div>
      <ol
        className="rf-rv__rail"
        role="tablist"
        aria-label={i18n.tSafe('export.preview' as MessageKey)}
        onKeyDown={onTabKeyDown}
      >
        {model.slides.map((slide, index) => (
          <li key={slide.id}>
            <button
              type="button"
              role="tab"
              id={tabId(index)}
              aria-selected={index === current}
              aria-controls={paneId}
              tabIndex={index === current ? 0 : -1}
              className={`rf-rv__pick${index === current ? ' rf-rv__pick--on' : ''}`}
              aria-label={`${slide.title} · ${localizeDigits(`${index + 1}/${model.slides.length}`, model.numberingSystem)}`}
              onClick={() => activate(index, false)}
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
            id={tabId(model.slides.length)}
            aria-selected={workbookTab}
            aria-controls={paneId}
            tabIndex={workbookTab ? 0 : -1}
            className={`rf-rv__pick${workbookTab ? ' rf-rv__pick--on' : ''}`}
            aria-label={exportFileName(model, 'xlsx')}
            onClick={() => activate(model.slides.length, false)}
            ref={(el) => { tabsRef.current[model.slides.length] = el; }}
          >
            <WorkbookPreview model={model} />
          </button>
        </li>
      </ol>
    </div>
  );
}
