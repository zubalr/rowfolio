/**
 * MiniReport — the finished report recomposed at plate scale. The same
 * ExportModel the PPTX/XLSX writers consume drives every string and figure
 * (label, scopeText, metricDisplayName, formatMetricValue/formatCompact,
 * exportUnitLabel/periodLabel), so the card cannot drift from the artifact.
 *
 * Unlike SlidePreview (a 16:9 whole-slide thumbnail that scales type down
 * with its container), this interior is composed for the plate: the title
 * reads near body size and the key stats, chart labels and folio stay at
 * real reading sizes at every viewport. `WorkbookMini` does the same for
 * the workbook figure — real sheet names, not a shrunken card.
 */
import type { ExportModel, Metric, SlideModel } from "@rowfolio/contracts";
import { exportUnitLabel, periodLabel } from "@rowfolio/export-model";
import {
  formatCompact,
  formatInteger,
  formatMetricValue,
  hasLabel,
  label,
  metricDisplayName,
  scopeText,
} from "@rowfolio/export-pptx";
import type { ReactElement } from "react";
import "./mini-report.css";

export interface MiniReportProps {
  readonly model: ExportModel;
  readonly slide: SlideModel;
}

export interface WorkbookMiniProps {
  readonly model: ExportModel;
}

function resolve(model: ExportModel, slide: SlideModel) {
  const metricById = new Map(model.metrics.map((m) => [m.id, m]));
  for (const m of model.scenario?.metrics ?? []) metricById.set(m.id, m);
  const chartById = new Map(model.charts.map((c) => [c.id, c]));
  const metrics = slide.metricIds
    .map((id) => metricById.get(id))
    .filter((m): m is Metric => m !== undefined);
  const finding = slide.findingIds
    .map((id) => model.findings.find((f) => f.id === id))
    .find((f) => f !== undefined);
  const chart = slide.chartIds.map((id) => chartById.get(id)).find((c) => c !== undefined);
  return { metrics, finding, chart };
}

/**
 * The report at plate scale: title + scope + the key stats + the real
 * chart marks + folio — one reading column, no shrink-to-fit whole slide.
 * The slide title already carries the finding's headline, so the finding
 * contributes its scope line rather than a duplicated sentence.
 */
export function MiniReport({ model, slide }: MiniReportProps): ReactElement {
  const rtl = model.locale === "ar";
  const { metrics, finding, chart } = resolve(model, slide);
  const index = Math.max(1, model.slides.indexOf(slide) + 1);
  const domainMax =
    chart === undefined ? 1 : Math.max(1, ...chart.points.flatMap((p) => chart.series.map((s) => Number(p.values[s.id] ?? 0))));
  const chartTitle =
    chart === undefined ? "" : hasLabel(chart.titleKey) ? label(model.locale, chart.titleKey) : chart.titleKey;
  const chartMeta =
    chart === undefined
      ? ""
      : [
          chart.series.map((s) => (hasLabel(s.labelKey) ? label(model.locale, s.labelKey) : s.id)).join(" / "),
          exportUnitLabel(chart.unit),
          periodLabel(chart.scope.periodStart, chart.scope.periodEnd, model.locale, model.numberingSystem),
        ]
          .filter((bit) => bit !== "")
          .join(" · ");

  return (
    <figure
      dir={rtl ? "rtl" : "ltr"}
      className="rf-mini"
      data-kind={slide.kind}
      data-slide={slide.id}
      aria-label={`${slide.title} · ${index}/${model.slides.length}`}
    >
      <header className="rf-mini__mast">
        <span className="rf-mini__tick" aria-hidden="true" />
        <p className="rf-mini__title">{slide.title}</p>
        <p className="rf-mini__sub">{slide.subtitle}</p>
      </header>
      <div className="rf-mini__body">
        <ul className="rf-mini__metrics">
          {metrics.slice(0, 4).map((metric) => (
            <li key={metric.id}>
              <span className="rf-mini__dot" aria-hidden="true" />
              <span className="rf-mini__mname">{metricDisplayName(model.locale, metric, model.metrics)}</span>
              <span className="rf-mini__mval">
                {metric.value === null ? "" : formatMetricValue(metric.value, metric.unit)}
              </span>
            </li>
          ))}
        </ul>
        {chart !== undefined && (
          <div className="rf-mini__viz">
            <div className="rf-mini__chart" dir="ltr" role="img" aria-label={chartTitle}>
              {chart.points.slice(0, 4).map((point) => (
                <div className="rf-mini__group" key={point.key}>
                  <div className="rf-mini__bars">
                    {chart.series.map((series) => {
                      const raw = point.values[series.id];
                      const h = raw == null ? 0 : Math.max(0, Math.min(100, (Number(raw) / domainMax) * 100));
                      return (
                        <span className="rf-mini__barcell" key={series.id}>
                          <span className="rf-mini__barval">
                            {raw == null
                              ? ""
                              : chart.unit.kind === "currency"
                                ? `${exportUnitLabel(chart.unit)} ${formatCompact(raw)}`.trim()
                                : formatMetricValue(raw, chart.unit)}
                          </span>
                          {/* The value label lives outside the track, so the
                              mark's percent height resolves against the
                              track alone — the bar scales, never its cell. */}
                          <span className="rf-mini__bartrack">
                            <span
                              className={`rf-mini__bar rf-mini__bar--${series.semantic}`}
                              style={{ height: `${h}%` }}
                            />
                          </span>
                        </span>
                      );
                    })}
                  </div>
                  <span className="rf-mini__cat">
                    {hasLabel(point.labelKey) ? label(model.locale, point.labelKey) : point.key}
                  </span>
                </div>
              ))}
            </div>
            <p className="rf-mini__chartcap">
              <span className="rf-mini__charttitle">{chartTitle}</span>
              <span className="rf-mini__chartmeta">{chartMeta}</span>
            </p>
          </div>
        )}
      </div>
      <footer className="rf-mini__foot">
        {finding !== undefined && (
          <span className="rf-mini__scope">{scopeText(model.locale, finding.scope, model.numberingSystem)}</span>
        )}
        <span className="rf-mini__folio">
          {index} / {model.slides.length}
        </span>
      </footer>
    </figure>
  );
}

/** The workbook figure at plate scale — real sheet names, readable. */
export function WorkbookMini({ model }: WorkbookMiniProps): ReactElement {
  const rtl = model.locale === "ar";
  return (
    <figure dir={rtl ? "rtl" : "ltr"} className="rf-mini rf-mini--book" data-kind="workbook">
      <header className="rf-mini__mast">
        <span className="rf-mini__tick" aria-hidden="true" />
        <p className="rf-mini__title">{model.slides[0]?.title ?? label(model.locale, "export.title")}</p>
        <p className="rf-mini__file" dir="ltr" title={`rowfolio-${model.exportId}.xlsx`}>
          {model.exportId.length > 20 ? `rowfolio-${model.exportId.slice(0, 20)}….xlsx` : `rowfolio-${model.exportId}.xlsx`}
        </p>
        <p className="rf-mini__rows">
          {formatInteger(String(model.qualitySummary.retainedRows))} /{" "}
          {formatInteger(String(model.qualitySummary.rawRows))} {label(model.locale, "common.rows")}
        </p>
      </header>
      <ul className="rf-mini__sheets">
        {model.sheets.map((sheet) => (
          <li key={sheet.id} dir={sheet.direction}>
            {sheet.name}
          </li>
        ))}
      </ul>
    </figure>
  );
}
