/**
 * Scenario-bars — baseline vs hypothetical scenario as paired bars on the
 * declared (fixed) domain. The scenario bar wears a dashed amber outline and
 * hatch fill, carries an explicit hypothetical label, and a margin/delta
 * indicator sits beside the pair. Axis extents never rescale when the
 * scenario moves, so changes are not exaggerated.
 */
import { useId, useMemo } from "react";
import type { PlotContext } from "../frame.tsx";
import { formatUnitValue } from "../localization.ts";
import { subtractCanonical, multiplyCanonical } from "../localization.ts";
import { valueScale } from "../scales.ts";
import {
  ChartTooltip,
  HitTarget,
  TooltipBody,
  ValueGrid,
  tooltipRows,
  type DatumAnchor,
} from "./shared.tsx";

const MARGIN = { top: 34, end: 20, bottom: 30, start: 56 };
const HEIGHT = 280;

interface ScenarioLayout {
  xOf: (v: number) => number;
  baselineX: number;
  scenarioXs: { key: string; x: number }[];
  barW: number;
  groupCx: Record<string, number>;
  anchors: Record<string, DatumAnchor>;
  zeroY: number;
  plotWidth: number;
}

function isBaselinePoint(key: string, index: number, baselineLabelKeys: readonly string[]): boolean {
  return key === "baseline" || baselineLabelKeys.includes(key) || index === 0;
}

export function layoutScenario(ctx: PlotContext): ScenarioLayout {
  const { model, width } = ctx;
  const plotWidth = Math.max(width - MARGIN.start - MARGIN.end, 80);
  const y = valueScale(model.domain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
  const zeroY = y(Math.max(0, Math.min(model.domain.max, Math.max(model.domain.min, 0))));
  const groupW = Math.min(220, plotWidth * 0.55);
  const barW = Math.min(72, groupW / (model.points.length + 0.4));
  const center = plotWidth / 2;
  const n = model.points.length;
  const groupCx: Record<string, number> = {};
  const anchors: Record<string, DatumAnchor> = {};
  let baselineX = center;
  const scenarioXs: { key: string; x: number }[] = [];
  model.points.forEach((p, i) => {
    const x = center - (n * barW) / 2 + i * barW;
    groupCx[p.key] = x + barW / 2;
    const v = p.values.find((vv) => vv.seriesId === model.series[0]?.id)?.coordinate;
    anchors[p.key] = { x: x + barW / 2, y: v != null ? Math.min(y(v), zeroY) : zeroY };
    if (isBaselinePoint(p.key, i, [])) baselineX = x;
    else scenarioXs.push({ key: p.key, x });
  });
  return { xOf: y, baselineX, scenarioXs, barW, groupCx, anchors, zeroY, plotWidth };
}

export function ScenarioBarsPlot({ ctx }: { ctx: PlotContext }) {
  const { model, strings } = ctx;
  const t = strings.t;
  const layout = useMemo(() => layoutScenario(ctx), [ctx]);
  const hatchId = `rf-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const series = model.series[0];
  const baselinePoint = model.points[0];
  const baselineVal = baselinePoint?.values.find((v) => v.seriesId === series?.id) ?? null;
  const scenarioPoints = model.points.filter((p, i) => !isBaselinePoint(p.key, i, []));
  const active = ctx.activeKey ? model.points.find((p) => p.key === ctx.activeKey) : null;

  const deltaChip = useMemo(() => {
    const sp = scenarioPoints[0];
    const sv = sp?.values.find((v) => v.seriesId === series?.id);
    if (!baselineVal?.value || !sv?.value) return null;
    const diff = subtractCanonical(sv.value, baselineVal.value);
    if (model.spec.unit.kind === "ratio") {
      const pp = multiplyCanonical(diff, "100");
      return {
        text: `${ctx.formatters.formatNumber(pp, { signDisplay: "always", useGrouping: false })} pp`,
        negative: diff.startsWith("-"),
        pair: `${formatUnitValue(baselineVal.value, model.spec.unit, ctx.formatters)} → ${formatUnitValue(sv.value, model.spec.unit, ctx.formatters)}`,
      };
    }
    return {
      text: formatUnitValue(diff, model.spec.unit, ctx.formatters, { signDisplay: "always" }),
      negative: diff.startsWith("-"),
      pair: `${formatUnitValue(baselineVal.value, model.spec.unit, ctx.formatters)} → ${formatUnitValue(sv.value, model.spec.unit, ctx.formatters)}`,
    };
  }, [scenarioPoints, baselineVal, series, model.spec.unit, ctx.formatters]);

  return (
    <div className="rf-chart-plot" {...ctx.explorerProps()}>
      <svg
        role="presentation"
        className="rf-chart-svg"
        width={ctx.width}
        height={HEIGHT}
        viewBox={`0 0 ${ctx.width} ${HEIGHT}`}
        direction="ltr" unicodeBidi="isolate"
      >
        <defs>
          <pattern
            id={hatchId}
            width="6"
            height="6"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              strokeWidth="1"
              style={{ stroke: "var(--rf-c-scenario)" }}
            />
          </pattern>
        </defs>
        <g transform={`translate(${MARGIN.start},0)`}>
          <ValueGrid
            ticks={model.ticks}
            yOf={layout.xOf}
            x0={0}
            x1={layout.plotWidth}
            unit={model.spec.unit}
            formatters={ctx.formatters}
          />
          <line x1={0} x2={layout.plotWidth} y1={layout.zeroY} y2={layout.zeroY} className="rf-chart-zero" />
          {model.points.map((p, i) => {
            const baseline = isBaselinePoint(p.key, i, []);
            const v = series ? p.values.find((vv) => vv.seriesId === series.id) : null;
            const vy = v?.coordinate != null ? layout.xOf(v.coordinate) : null;
            const x = layout.groupCx[p.key]! - layout.barW / 2;
            return (
              <g key={p.key} {...ctx.datumProps(p.key)}>
                <HitTarget
                  x={layout.groupCx[p.key]! - 24}
                  y={MARGIN.top - 24}
                  width={48}
                  height={HEIGHT - MARGIN.top - MARGIN.bottom + 24}
                />
                {vy !== null ? (
                  <>
                    <rect
                      x={x}
                      y={Math.min(vy, layout.zeroY)}
                      width={layout.barW}
                      height={Math.max(Math.abs(layout.zeroY - vy), 1)}
                      rx={2}
                      style={{
                        fill: baseline ? "var(--rf-c-data)" : `url(#${hatchId})`,
                        ...(baseline ? {} : { stroke: "var(--rf-c-scenario)" }),
                      }}
                      stroke={baseline ? "none" : undefined}
                      strokeWidth={baseline ? 0 : 1.5}
                      strokeDasharray={baseline ? undefined : "5 3"}
                      data-neg={((v?.coordinate ?? 0) < 0) || undefined}
                      className="rf-chart-bar"
                    />
                    <text
                      x={layout.groupCx[p.key]!}
                      y={Math.min(vy, layout.zeroY) - 8}
                      textAnchor="middle"
                      className="rf-chart-value"
                      direction="ltr" unicodeBidi="isolate"
                    >
                      {formatUnitValue(v!.value!, model.spec.unit, ctx.formatters)}
                    </text>
                    {!baseline ? (
                      <text
                        x={layout.groupCx[p.key]!}
                        y={Math.min(vy, layout.zeroY) - 22}
                        textAnchor="middle"
                        className="rf-chart-hypo"
                      >
                        {t("common.scenario")}
                      </text>
                    ) : null}
                  </>
                ) : (
                  <text
                    x={layout.groupCx[p.key]!}
                    y={layout.zeroY - 6}
                    textAnchor="middle"
                    className="rf-chart-missing"
                  >
                    —
                  </text>
                )}
                <text
                  x={layout.groupCx[p.key]!}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="rf-chart-cat"
                  direction="auto"
                >
                  {t(p.labelKey)}
                </text>
              </g>
            );
          })}
          {deltaChip !== null ? (
            <g className="rf-chart-deltagroup" aria-hidden="true">
              <text
                x={layout.plotWidth - 4}
                y={MARGIN.top - 14}
                textAnchor="end"
                className={`rf-chart-delta${deltaChip.negative ? " rf-chart-delta--neg" : " rf-chart-delta--pos"}`}
              >
                {deltaChip.pair}
              </text>
              <text
                x={layout.plotWidth - 4}
                y={MARGIN.top + 2}
                textAnchor="end"
                className={`rf-chart-delta rf-chart-delta--big${deltaChip.negative ? " rf-chart-delta--neg" : " rf-chart-delta--pos"}`}
              >
                {deltaChip.text}
              </text>
            </g>
          ) : null}
        </g>
      </svg>
      <p className="rf-chart-note">{t("limitations.noForecast")}</p>
      {active && layout.anchors[active.key] ? (
        <ChartTooltip anchor={layout.anchors[active.key]!} stageWidth={ctx.width}>
          <TooltipBody {...tooltipRows(active, model.series, ctx)} />
        </ChartTooltip>
      ) : null}
    </div>
  );
}
