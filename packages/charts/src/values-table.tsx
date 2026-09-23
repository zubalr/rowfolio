/**
 * ChartValuesTable — the evidence table pattern behind "View values".
 *
 * Exact chart/table parity: every row lists the spec's canonical values,
 * formatted through the caller's formatters; nothing is read back from pixel
 * geometry and no derived column recomputes beyond the exact decimal
 * variance/delta helpers (display derivations, not metric recomputation).
 * Metric and provenance IDs render as LTR mono islands for traceability.
 */
import type { Decimal } from "@rowfolio/contracts";
import { isZeroDecimal, multiplyDecimal, subtractDecimal } from "@rowfolio/contracts";
import type { ChartModel, ResolvedSeries } from "./model.ts";
import { absoluteVariance, relativeVariance } from "./model.ts";
import {
  formatUnitValue,
  type ChartFormatters,
  type ChartLocalization,
} from "./localization.ts";

interface Column {
  id: string;
  label: string;
  align: "start" | "end";
  mono?: boolean;
  dir?: "ltr";
}

function pointValue(point: ChartModel["points"][number], seriesId: string): Decimal | null {
  return point.values.find((v) => v.seriesId === seriesId)?.value ?? null;
}

function columnsFor(model: ChartModel, t: ChartLocalization["t"]): Column[] {
  const cols: Column[] = model.series.map((s: ResolvedSeries) => ({
    id: `s:${s.id}`,
    label: t(s.labelKey),
    align: "end" as const,
  }));
  const kind = model.spec.kind;
  if (kind === "target-bars") {
    const actual = model.series.find((s) => s.semantic === "observed");
    const target = model.series.find((s) => s.semantic === "target");
    if (actual && target) {
      cols.push({ id: "variance", label: t("common.change"), align: "end" });
      cols.push({ id: "variance-pct", label: `${t("common.change")} %`, align: "end" });
    }
  }
  if (kind === "scenario-bars" && model.points.length >= 2) {
    cols.push({ id: "delta", label: t("common.change"), align: "end" });
  }
  cols.push({ id: "metricIds", label: t("common.source"), align: "start", mono: true, dir: "ltr" });
  return cols;
}

function cellText(
  col: Column,
  model: ChartModel,
  pointIndex: number,
  formatters: ChartFormatters,
  t: ChartLocalization["t"],
): string {
  const point = model.points[pointIndex]!;
  if (col.id.startsWith("s:")) {
    const v = pointValue(point, col.id.slice(2));
    return v === null ? t("common.notAvailable") : formatUnitValue(v, model.spec.unit, formatters);
  }
  if (col.id === "metricIds") return point.metricIds.join(", ");
  const kind = model.spec.kind;
  if (kind === "target-bars" && (col.id === "variance" || col.id === "variance-pct")) {
    const actual = model.series.find((s) => s.semantic === "observed");
    const target = model.series.find((s) => s.semantic === "target");
    const a = actual ? pointValue(point, actual.id) : null;
    const b = target ? pointValue(point, target.id) : null;
    if (a === null || b === null) return t("common.notAvailable");
    if (col.id === "variance") {
      return formatUnitValue(absoluteVariance(a, b), model.spec.unit, formatters, {
        signDisplay: "exceptZero",
      });
    }
    const rel = relativeVariance(a, b);
    return rel === null ? t("common.undefined") : formatters.formatPercent(rel, { signDisplay: "exceptZero", maxFractionDigits: 1 });
  }
  if (kind === "scenario-bars" && col.id === "delta") {
    const base = model.points[0]!;
    const baseVal = pointValue(base, model.series[0]!.id);
    const v = pointValue(point, model.series[0]!.id);
    if (baseVal === null || v === null || pointIndex === 0) return "—";
    return deltaText(baseVal, v, model.spec.unit, formatters);
  }
  return "";
}

function deltaText(
  base: Decimal,
  value: Decimal,
  unit: ChartModel["spec"]["unit"],
  formatters: ChartFormatters,
): string {
  const diff = subtractDecimal(value, base);
  if (unit.kind === "ratio") {
    const pp = multiplyDecimal(diff, "100");
    return `${formatters.formatNumber(pp, { signDisplay: "always", useGrouping: false })} pp`;
  }
  if (isZeroDecimal(diff)) return formatters.formatNumber("0");
  return formatUnitValue(diff, unit, formatters, { signDisplay: "always" });
}

export function ChartValuesTable({
  model,
  localization,
}: {
  model: ChartModel;
  localization: ChartLocalization;
}) {
  const t = localization.t;
  const cols = columnsFor(model, t);
  const catLabel = model.spec.chronology === "ltr" ? t("common.period") : t("workspace.scope");
  return (
    <div className="rf-chart-table" role="region" aria-label={t("a11y.chartTable")} tabIndex={0}>
      <table>
        <caption>{t("a11y.chartTable")}</caption>
        <thead>
          <tr>
            <th scope="col" data-align="start">
              {model.spec.chronology === "ltr" ? catLabel : t("workspace.scope")}
            </th>
            {cols.map((c) => (
              <th key={c.id} scope="col" data-align={c.align}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.points.map((p, i) => (
            <tr key={p.key}>
              <th scope="row" dir="auto">
                {t(p.labelKey)}
              </th>
              {cols.map((c) => (
                <td key={c.id} data-align={c.align} dir={c.dir}>
                  {c.mono || c.dir === "ltr" ? (
                    <bdi dir="ltr" className="rf-chart-table__mono">
                      {cellText(c, model, i, localization.formatters, t)}
                    </bdi>
                  ) : (
                    cellText(c, model, i, localization.formatters, t)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {model.spec.provenanceIds.length > 0 ? (
        <p className="rf-chart-table__provenance">
          {t("common.method")}: <bdi dir="ltr">{model.spec.provenanceIds.join(", ")}</bdi>
        </p>
      ) : null}
    </div>
  );
}
