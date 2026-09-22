/**
 * SlidePreview — a readable preview of the real deliverable, driven by the
 * same ExportModel the PPTX/XLSX writers consume. Every string and figure
 * resolves through the export-pptx copy tables and formatters (label,
 * scopeText, metricDisplayName, formatMetricValue/formatCompact), so the
 * preview cannot drift from the artifact: what you read here is what
 * downloads.
 *
 * Composition mirrors the deck — masthead tick + title + subtitle, a body
 * band with the slide's real content (headline, scope, figures, chart marks),
 * hairline footer with the folio — and mirrors horizontally for RTL locales,
 * matching the mx() flip the deck writer performs.
 */
import type { ChartSpec, ExportModel, Finding, Metric, SlideModel } from '@rowfolio/contracts';
import { exportFileName, exportUnitLabel, localizeDigits, periodLabel } from '@rowfolio/export-model';
import {
  formatCompact,
  formatInteger,
  formatMetricValue,
  hasLabel,
  label,
  metricDisplayName,
  qualityTrackMetrics,
  scopeText,
  spanTokensForModel,
} from '@rowfolio/export-pptx';
import type { ReactElement } from 'react';
import './slide-preview.css';

export interface SlidePreviewProps {
  model: ExportModel;
  slide: SlideModel;
  className?: string;
  /**
   * Renders the figure as inert navigation chrome (a picker thumbnail):
   * hidden from assistive tech and stripped of interactive elements —
   * callers wrap it in the button/tab that carries the accessible name.
   */
  nav?: boolean;
}

export interface WorkbookPreviewProps {
  model: ExportModel;
  className?: string;
}

const SERIES_CLASS: Record<string, string> = {
  observed: 'rf-sp__bar--observed',
  target: 'rf-sp__bar--target',
  scenario: 'rf-sp__bar--scenario',
  attention: 'rf-sp__bar--attention',
};

/** Compact figure readout for a mark — compact currency, exact otherwise. */
function chartValue(raw: string, chart: ChartSpec, model: ExportModel): string {
  const labeler = (k: string) => label(model.locale, k);
  return chart.unit.kind === 'currency'
    ? `${exportUnitLabel(chart.unit, labeler)} ${formatCompact(raw, model.numberingSystem)}`.trim()
    : formatMetricValue(raw, chart.unit, labeler, model.numberingSystem);
}

/**
 * Column marks over the chart's real points, scaled to its declared domain,
 * with the value on each mark and the category under the baseline — the same
 * figure anatomy the native chart part carries in the PPTX.
 */
function MiniChart({ model, chart }: { model: ExportModel; chart: ChartSpec }): ReactElement {
  const domainMax = Math.max(Number(chart.domain.max), 1);
  const labelFor = (key: string, fallback: string): string =>
    hasLabel(key) ? label(model.locale, key) : fallback;
  const title = labelFor(chart.titleKey, label(model.locale, 'common.metric'));
  return (
    <div className="rf-sp__chart" dir="ltr" role="img" aria-label={title}>
      {chart.points.slice(0, 8).map((point) => (
        <div className="rf-sp__chart-group" key={point.key}>
          <div className="rf-sp__bars">
            {chart.series.map((series) => {
              const raw = point.values[series.id];
              const height = raw == null ? 0 : Math.max(0, Math.min(88, (Number(raw) / domainMax) * 88));
              return (
                <span className="rf-sp__barcell" key={series.id}>
                  <span className="rf-sp__barval">{raw == null ? '' : chartValue(raw, chart, model)}</span>
                  {/* The value label lives outside the track, so the mark's
                      percent height resolves against the track alone. */}
                  <span className="rf-sp__bartrack">
                    <span
                      className={`rf-sp__bar ${SERIES_CLASS[series.semantic] ?? 'rf-sp__bar--observed'}`}
                      style={{ height: `${height}%` }}
                    />
                  </span>
                </span>
              );
            })}
          </div>
          <span className="rf-sp__cat">{labelFor(point.labelKey, label(model.locale, 'common.metric'))}</span>
        </div>
      ))}
    </div>
  );
}

/** Title + named comparison + unit + period — mirrors the deck's chart caption. */
function ChartCaption({ model, chart }: { model: ExportModel; chart: ChartSpec }): ReactElement {
  const title = hasLabel(chart.titleKey) ? label(model.locale, chart.titleKey) : label(model.locale, 'common.metric');
  const names = chart.series
    .map((s) => (hasLabel(s.labelKey) ? label(model.locale, s.labelKey) : label(model.locale, 'common.metric')))
    .join(' / ');
  const meta = [
    names,
    exportUnitLabel(chart.unit, (k) => label(model.locale, k)),
    periodLabel(chart.scope.periodStart, chart.scope.periodEnd, model.locale, model.numberingSystem),
  ].filter((bit) => bit !== '').join(' · ');
  return (
    <p className="rf-sp__chart-caption">
      <span className="rf-sp__chart-title">{title}</span>
      <span className="rf-sp__chart-meta">{meta}</span>
    </p>
  );
}

function Name({ model, metric }: { model: ExportModel; metric: Metric }): ReactElement {
  return <span className="rf-sp__metric-name">{metricDisplayName(model.locale, metric, model.metrics)}</span>;
}

function Value({ model, metric, compact = false }: { model: ExportModel; metric: Metric; compact?: boolean }): ReactElement {
  const unavailable = metric.value === null || metric.status !== 'defined';
  const labeler = (k: string) => label(model.locale, k);
  let text = formatMetricValue(metric.value, metric.unit, labeler, model.numberingSystem);
  if (compact && metric.value !== null && metric.unit.kind === 'currency') {
    text = `${exportUnitLabel(metric.unit, labeler)} ${formatCompact(metric.value, model.numberingSystem)}`.trim();
  }
  return (
    <span className={`rf-sp__metric-value${unavailable ? ' rf-sp__metric-value--muted' : ''}`}>{text}</span>
  );
}

function MetricList({ model, metrics, limit }: { model: ExportModel; metrics: Metric[]; limit: number }): ReactElement {
  return (
    <ul className="rf-sp__metrics">
      {metrics.slice(0, limit).map((metric) => (
        <li key={metric.id}>
          <span className="rf-sp__dot" aria-hidden="true" />
          <Name model={model} metric={metric} /> <Value model={model} metric={metric} />
        </li>
      ))}
    </ul>
  );
}

function SummaryBody({ model, metrics, finding }: { model: ExportModel; metrics: Metric[]; finding?: Finding | undefined }): ReactElement {
  // The deck carries the finding's evidence list, not slide-level ids.
  const evidence = finding !== undefined && metrics.length === 0 ? finding.metricIds : [];
  const shown = metrics.length > 0 ? metrics : evidence.map((id) => model.metrics.find((m) => m.id === id)).filter((m): m is Metric => m !== undefined);
  const q = model.qualitySummary;
  const kept = q.rawRows > 0 ? (q.retainedRows / q.rawRows) * 100 : 0;
  return (
    <div className="rf-sp__split">
      <div className="rf-sp__text">
        {finding === undefined ? (
          <p className="rf-sp__headline rf-sp__headline--muted">{label(model.locale, 'empty.noFindings')}</p>
        ) : (
          <>
            <p className="rf-sp__headline">{label(model.locale, finding.titleKey)}</p>
            <p className="rf-sp__scope">{scopeText(model.locale, finding.scope, model.numberingSystem)}</p>
          </>
        )}
        <MetricList model={model} metrics={shown} limit={3} />
      </div>
      <div className="rf-sp__card">
        <p className="rf-sp__card-label">{label(model.locale, 'common.rawInput')}</p>
        <p className="rf-sp__card-value">{localizeDigits(formatInteger(String(q.rawRows)), model.numberingSystem)}</p>
        <div className="rf-sp__lineage" dir="ltr">
          <span className="rf-sp__lineage-bar rf-sp__lineage-bar--raw" style={{ inlineSize: '100%' }} />
          <span className="rf-sp__lineage-bar rf-sp__lineage-bar--kept" style={{ inlineSize: `${Math.max(4, kept)}%` }} />
        </div>
        <p className="rf-sp__card-label">{label(model.locale, 'common.retained')}</p>
        <p className="rf-sp__card-value">{localizeDigits(formatInteger(String(q.retainedRows)), model.numberingSystem)}</p>
      </div>
    </div>
  );
}

function KpiBody({ model, metrics }: { model: ExportModel; metrics: Metric[] }): ReactElement {
  return (
    <div className="rf-sp__kpis">
      <div className="rf-sp__kpi-row">
        {metrics.slice(0, 4).map((metric) => (
          <div className="rf-sp__kpi" key={metric.id}>
            <Value model={model} metric={metric} compact />
            <Name model={model} metric={metric} />
          </div>
        ))}
      </div>
      <table className="rf-sp__table">
        <tbody>
          {metrics.slice(0, 4).map((metric) => (
            <tr key={metric.id}>
              <td><Name model={model} metric={metric} /></td>
              <td className="rf-sp__num"><Value model={model} metric={metric} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingBody({
  model,
  metrics,
  finding,
  chart,
}: {
  model: ExportModel;
  metrics: Metric[];
  finding?: Finding | undefined;
  chart?: ChartSpec | undefined;
}): ReactElement {
  const scoped = finding === undefined ? metrics : finding.metricIds
    .map((id) => model.metrics.find((m) => m.id === id))
    .filter((m): m is Metric => m !== undefined);
  return (
    <div className="rf-sp__split">
      <div className="rf-sp__text">
        {finding !== undefined && (
          <>
            <p className="rf-sp__headline">{label(model.locale, finding.titleKey)}</p>
            <p className="rf-sp__scope">{scopeText(model.locale, finding.scope, model.numberingSystem)}</p>
          </>
        )}
        <MetricList model={model} metrics={scoped} limit={3} />
      </div>
      {chart !== undefined && (
        <div className="rf-sp__visual">
          <MiniChart model={model} chart={chart} />
          <ChartCaption model={model} chart={chart} />
        </div>
      )}
    </div>
  );
}

function ScenarioBody({ model, metrics, chart }: { model: ExportModel; metrics: Metric[]; chart?: ChartSpec | undefined }): ReactElement {
  const committed = model.scenario !== null;
  return (
    <div className={committed ? 'rf-sp__split' : 'rf-sp__empty'}>
      <div className="rf-sp__text">
        <p className="rf-sp__kicker rf-sp__kicker--scenario">{label(model.locale, 'scenario.layer')}</p>
        {committed ? (
          <>
            <p className="rf-sp__headline rf-sp__headline--small">{label(model.locale, 'scenario.question')}</p>
            <MetricList model={model} metrics={metrics} limit={3} />
          </>
        ) : (
          <p className="rf-sp__headline rf-sp__headline--small">{label(model.locale, 'scenario.notCommitted')}</p>
        )}
      </div>
      {committed && chart !== undefined && (
        <div className="rf-sp__visual">
          <MiniChart model={model} chart={chart} />
          <ChartCaption model={model} chart={chart} />
        </div>
      )}
    </div>
  );
}

/**
 * Quality page — mirrors layoutQuality: the three check-count tracks resolved
 * from the deck's own id space (cobalt/slate/amber fills against a shared
 * scale), beside the reconciliation card (resolved / unresolved / issues +
 * the no-imputation note). Generic uploads without those check metrics show
 * the card alone — exactly what the deck carries.
 */
function QualityBody({ model, metricById }: { model: ExportModel; metricById: ReadonlyMap<string, Metric> }): ReactElement {
  const q = model.qualitySummary;
  const tracks = qualityTrackMetrics(metricById);
  const peak = Math.max(1, ...tracks.map((m) => Number(m.value ?? '0')));
  return (
    <div className="rf-sp__split">
      <div className="rf-sp__tracks">
        {tracks.map((metric) => (
          <div className="rf-sp__track" key={metric.id}>
            <p>
              <Name model={model} metric={metric} /> <Value model={model} metric={metric} />
            </p>
            <div className="rf-sp__rail" dir="ltr">
              <span
                className="rf-sp__rail-fill rf-sp__rail-fill--problem"
                style={{ inlineSize: `${Math.max(3, (Number(metric.value ?? '0') / peak) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="rf-sp__card">
        <p className="rf-sp__card-label">{label(model.locale, 'quality.reconciliation')}</p>
        <p className="rf-sp__card-line">
          {label(model.locale, 'quality.resolved')}{' '}
          <b className="rf-sp__pos">{localizeDigits(formatInteger(String(q.resolved)), model.numberingSystem)}</b>
        </p>
        <p className="rf-sp__card-line">
          {label(model.locale, 'quality.unresolved')}{' '}
          <b>{localizeDigits(formatInteger(String(q.unresolved)), model.numberingSystem)}</b>
        </p>
        <p className="rf-sp__card-line rf-sp__card-line--muted">
          {label(model.locale, 'quality.issues')} <b>{localizeDigits(formatInteger(String(q.issueCount)), model.numberingSystem)}</b>
        </p>
        {/* Deck parity: the no-imputation note only renders when missing
            cells exist — zero missing must not read as a warning. */}
        {Number(tracks.find((m) => m.id === 'quality-missing')?.value ?? '0') > 0 && (
          <p className="rf-sp__card-line rf-sp__card-line--muted">
            {label(model.locale, 'quality.noImputation')}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Method page — mirrors layoutMethodology: source card (workbook, sheet,
 * retained rows, the row-span tokens, then limitation lines) beside the
 * verified column (provenance proof names resolved to their metric labels
 * and formatted values), closing with the no-imputation note.
 */
function MethodologyBody({ model, nav }: { model: ExportModel; nav: boolean }): ReactElement {
  const ref = model.table.sourceRef;
  const spans = spanTokensForModel(model);
  const limits = [...new Set(model.findings.flatMap((f) => f.limitations))]
    .filter((key) => hasLabel(key))
    .slice(0, 3);
  if (!limits.includes('limitations.noForecast') && hasLabel('limitations.noForecast')) {
    limits.push('limitations.noForecast');
  }
  const verified = model.provenance.slice(0, 2).map((proof) => {
    const metric = model.metrics.find((m) => m.provenanceId === proof.id);
    const name = metric !== undefined && hasLabel(metric.labelKey)
      ? label(model.locale, metric.labelKey)
      : label(model.locale, 'evidence.calculation');
    const shown = metric !== undefined && metric.value !== null
      ? formatMetricValue(metric.value, metric.unit, (k) => label(model.locale, k), model.numberingSystem)
      : (proof.result ?? '');
    return { id: proof.id, text: `${name} = ${shown}` };
  });
  return (
    <div className="rf-sp__split">
      <div className="rf-sp__card">
        <p className="rf-sp__card-label">{label(model.locale, 'common.source')}</p>
        <p className="rf-sp__card-value rf-sp__card-value--file">{ref.workbookName}</p>
        <p className="rf-sp__card-line rf-sp__card-line--muted">
          {label(model.locale, 'common.sheet')}: {ref.sheetName}
        </p>
        <p className="rf-sp__card-line rf-sp__card-line--muted">
          {localizeDigits(formatInteger(String(model.qualitySummary.retainedRows)), model.numberingSystem)} / {localizeDigits(formatInteger(String(model.qualitySummary.rawRows)), model.numberingSystem)}{' '}
          {label(model.locale, 'common.rows')}
        </p>
        {spans !== null && (
          <p className="rf-sp__card-line rf-sp__card-line--muted">
            {label(model.locale, 'evidence.sourceRows')}: {spans}
          </p>
        )}
        {nav ? (
          <p className="rf-sp__tech rf-sp__card-line rf-sp__card-line--muted">{label(model.locale, 'common.technicalDetails')}</p>
        ) : (
          <details className="rf-sp__tech">
            <summary>{label(model.locale, 'common.technicalDetails')}</summary>
            <p className="rf-sp__card-line rf-sp__card-line--mono">{model.sourceHash.slice(0, 12)}</p>
          </details>
        )}
      </div>
      <div className="rf-sp__text">
        <p className="rf-sp__kicker rf-sp__kicker--verified">{label(model.locale, 'common.verified')}</p>
        {verified.map((line) => (
          <p className="rf-sp__card-line" key={line.id}>{line.text}</p>
        ))}
        {limits.map((key) => (
          <p className="rf-sp__card-line rf-sp__card-line--muted" key={key}>{label(model.locale, key)}</p>
        ))}
        {model.findings.some((f) => f.limitations.includes('limitations.missingRetained')) && (
          <p className="rf-sp__card-line rf-sp__card-line--muted">{label(model.locale, 'quality.noImputation')}</p>
        )}
      </div>
    </div>
  );
}

export function SlidePreview({ model, slide, className, nav = false }: SlidePreviewProps): ReactElement {
  const rtl = model.locale === 'ar';
  // Scenario metrics live on the scenario result, not model.metrics — the
  // deck resolves them there too (cost/contribution/margin).
  const metricById = new Map(model.metrics.map((m) => [m.id, m]));
  for (const m of model.scenario?.metrics ?? []) metricById.set(m.id, m);
  const findingById = new Map(model.findings.map((f) => [f.id, f]));
  const chartById = new Map(model.charts.map((c) => [c.id, c]));
  const metrics = slide.metricIds.map((id) => metricById.get(id)).filter((m): m is Metric => m !== undefined);
  const finding = slide.findingIds.map((id) => findingById.get(id)).find((f): f is Finding => f !== undefined);
  const chart = slide.chartIds.map((id) => chartById.get(id)).find((c) => c !== undefined);
  const index = Math.max(1, model.slides.indexOf(slide) + 1);

  let body: ReactElement;
  switch (slide.kind) {
    case 'summary':
      body = <SummaryBody model={model} metrics={metrics} finding={finding} />;
      break;
    case 'kpis':
      body = <KpiBody model={model} metrics={metrics} />;
      break;
    case 'finding':
      body = <FindingBody model={model} metrics={metrics} finding={finding} chart={chart} />;
      break;
    case 'scenario':
      body = <ScenarioBody model={model} metrics={metrics} chart={chart} />;
      break;
    case 'quality':
      body = <QualityBody model={model} metricById={metricById} />;
      break;
    default:
      body = <MethodologyBody model={model} nav={nav} />;
      break;
  }

  return (
    <figure
      dir={rtl ? 'rtl' : 'ltr'}
      className={`rf-sp${className ? ` ${className}` : ''}`}
      data-kind={slide.kind}
      data-slide={slide.id}
      aria-label={nav ? undefined : `${slide.title} · ${localizeDigits(`${index}/${model.slides.length}`, model.numberingSystem)}`}
      aria-hidden={nav || undefined}
    >
      <header className="rf-sp__mast">
        <span className="rf-sp__tick" aria-hidden="true" />
        <p className="rf-sp__title">{slide.title}</p>
        <p className="rf-sp__subtitle">{slide.subtitle}</p>
      </header>
      <div className="rf-sp__body">{body}</div>
      <footer className="rf-sp__foot">
        <span className="rf-sp__folio">
          {localizeDigits(`${index} / ${model.slides.length}`, model.numberingSystem)}
        </span>
      </footer>
    </figure>
  );
}

/** Workbook entry: the real sheet list with its declared directions. */
export function WorkbookPreview({ model, className }: WorkbookPreviewProps): ReactElement {
  const rtl = model.locale === 'ar';
  return (
    <figure
      dir={rtl ? 'rtl' : 'ltr'}
      className={`rf-sp rf-sp--workbook${className ? ` ${className}` : ''}`}
      data-kind="workbook"
    >
      <header className="rf-sp__mast">
        <span className="rf-sp__tick rf-sp__tick--sheet" aria-hidden="true" />
        <p className="rf-sp__title">{model.slides[0]?.title ?? label(model.locale, 'export.title')}</p>
        <p className="rf-sp__subtitle rf-sp__title--file" dir="ltr" title={exportFileName(model, 'xlsx')}>
          {exportFileName(model, 'xlsx')}
        </p>
        <p className="rf-sp__wrows">
          {localizeDigits(formatInteger(String(model.qualitySummary.retainedRows)), model.numberingSystem)} / {localizeDigits(formatInteger(String(model.qualitySummary.rawRows)), model.numberingSystem)}{' '}
          {label(model.locale, 'common.rows')}
        </p>
      </header>
      <ul className="rf-sp__sheets">
        {model.sheets.map((sheet) => (
          <li key={sheet.id} dir={sheet.direction}>
            {sheet.name}
          </li>
        ))}
      </ul>
    </figure>
  );
}
