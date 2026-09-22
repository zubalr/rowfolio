/**
 * Target-bars — horizontal bullet-style actual/target rows by category
 * (region). Actual is a solid cobalt bar, target an ink tick marker, and a
 * signed variance annotation sits at the row end. At narrow widths the plot
 * keeps the selected datum plus a compact category selector instead of
 * squeezing six labels in.
 */
import { useMemo, useState } from "react";
import type { PlotContext } from "../frame.tsx";
import { formatUnitValue } from "../localization.ts";
import { relativeVariance } from "../model.ts";
import { valueScale } from "../scales.ts";
import {
  ChartTooltip,
  HitTarget,
  TooltipBody,
  formatAxisTick,
  tooltipRows,
  unitAxisLabel,
  type DatumAnchor,
} from "./shared.tsx";

const ROW_H = 56;
const BAR_H = 22;
const LABEL_COL = 148;
const VALUE_W = 96;
const NARROW_SINGLE = 560;

interface TargetRow {
  key: string;
  actualX: number;
  actualW: number;
  targetX: number | null;
  zeroX: number;
  actual: string | null;
  target: string | null;
  anchor: DatumAnchor;
}

interface TargetTick {
  tick: number;
  /** Gridline x (true tick position). */
  x: number;
  /** Label center x, clamped inside the plot so edge labels cannot clip. */
  cx: number;
  /** Estimated rendered width; currency ticks emit full precision. */
  w: number;
  label: string;
}

interface TargetLayout {
  rows: TargetRow[];
  anchors: Record<string, DatumAnchor>;
  plotWidth: number;
  ticks: TargetTick[];
  /** Subset of ticks whose labels render without colliding. */
  labeledTicks: TargetTick[];
  xOf: (v: number) => number;
}

const TICK_GLYPH_W = 7;
const TICK_GAP = 10;

/** Keep the max label (defines the scale), then the zero label, then interior
 * ticks from the right — dropping any whose estimated box would collide. */
function thinTicks(ticks: TargetTick[]): TargetTick[] {
  const n = ticks.length;
  const order = [n - 1, 0];
  for (let i = n - 2; i >= 1; i--) order.push(i);
  const kept: TargetTick[] = [];
  const fits = (e: TargetTick) =>
    kept.every(
      (k) => e.cx + e.w / 2 + TICK_GAP <= k.cx - k.w / 2 || k.cx + k.w / 2 + TICK_GAP <= e.cx - e.w / 2,
    );
  for (const i of order) {
    const e = ticks[i]!;
    if (fits(e)) kept.push(e);
  }
  return kept.sort((a, b) => a.cx - b.cx);
}

export function layoutTarget(ctx: PlotContext, keys: string[], labelCol: number): TargetLayout {
  const { model } = ctx;
  const plotWidth = Math.max(ctx.width - labelCol - VALUE_W, 60);
  const x = valueScale(model.domain, [0, plotWidth]);
  const zeroX = x(0);
  const barSeries = model.series.filter((s) => s.semantic !== "target");
  const markerSeries = model.series.filter((s) => s.semantic === "target");
  const primary = barSeries[0];
  const marker = markerSeries[0];
  const rows: TargetRow[] = [];
  const anchors: Record<string, DatumAnchor> = {};
  model.points.forEach((p) => {
    if (!keys.includes(p.key)) return;
    const a = primary ? (p.values.find((v) => v.seriesId === primary.id) ?? null) : null;
    const b = marker ? (p.values.find((v) => v.seriesId === marker.id) ?? null) : null;
    const ax = a?.coordinate != null ? x(a.coordinate) : null;
    const bx = b?.coordinate != null ? x(b.coordinate) : null;
    const row: TargetRow = {
      key: p.key,
      actualX: ax !== null ? Math.min(zeroX, ax) : zeroX,
      actualW: ax !== null ? Math.abs(ax - zeroX) : 0,
      targetX: bx,
      zeroX,
      actual: a?.value ?? null,
      target: b?.value ?? null,
      anchor: { x: ax ?? zeroX, y: rows.length * ROW_H + ROW_H / 2 },
    };
    anchors[p.key] = { x: labelCol + row.anchor.x, y: row.anchor.y };
    rows.push(row);
  });
  const ticks: TargetTick[] = model.ticks.map((tick) => {
    const label = formatAxisTick(tick, model.spec.unit, ctx.formatters);
    const w = label.length * TICK_GLYPH_W;
    const xi = x(tick);
    return {
      tick,
      x: xi,
      cx: Math.min(Math.max(xi, w / 2), Math.max(plotWidth - w / 2, w / 2)),
      w,
      label,
    };
  });
  return {
    rows,
    anchors,
    plotWidth,
    ticks,
    labeledTicks: thinTicks(ticks),
    xOf: x,
  };
}

function RowContent({ ctx, row, rowY, emphasized, width }: { ctx: PlotContext; row: TargetRow; rowY: number; emphasized: boolean; width: number }) {
  const { model } = ctx;
  const t = ctx.strings.t;
  const barCy = ROW_H / 2;
  const rel =
    row.actual !== null && row.target !== null ? relativeVariance(row.actual, row.target) : null;
  const relNeg = rel !== null && rel.startsWith("-");
  const actualEnd = row.actualX + row.actualW;
  const gapW = row.actual !== null && row.targetX !== null ? Math.abs(row.targetX - actualEnd) : 0;
  return (
    <g transform={`translate(0,${rowY})`}>
      {emphasized ? (
        <rect
          className="rf-chart-cellsel"
          x={1}
          y={1}
          width={Math.max(width - 2, 0)}
          height={ROW_H - 2}
          rx={2}
        />
      ) : null}
      {gapW >= 2 && row.targetX !== null ? (
        <rect
          className={`rf-chart-deltaarea ${relNeg ? "rf-chart-deltaarea--neg" : "rf-chart-deltaarea--pos"}`}
          x={Math.min(actualEnd, row.targetX)}
          y={barCy - BAR_H / 2}
          width={gapW}
          height={BAR_H}
        />
      ) : null}
      {row.actual !== null ? (
        <rect
          x={row.actualX}
          y={barCy - BAR_H / 2}
          width={row.actualW}
          height={BAR_H}
          rx={2}
          className="rf-chart-bar"
          data-neg={(row.actual !== null && row.actual.startsWith("-")) || undefined}
          style={{ fill: "var(--rf-c-data)" }}
        />
      ) : (
        <text x={row.zeroX + 4} y={barCy} dy="0.32em" className="rf-chart-missing">
          —
        </text>
      )}
      {row.targetX !== null ? (
        <g aria-hidden="true">
          <line
            x1={row.targetX}
            x2={row.targetX}
            y1={barCy - BAR_H / 2 - 6}
            y2={barCy + BAR_H / 2 + 6}
            strokeWidth={2}
            strokeDasharray="4 3"
            className="rf-chart-target"
            style={{ stroke: "var(--rf-c-ink)" }}
          />
          <title>{t("common.target")}</title>
        </g>
      ) : null}
      {row.actual !== null ? (
        <text
          x={row.actualX + row.actualW + 6}
          y={barCy}
          dy="0.32em"
          className="rf-chart-value rf-chart-value--end"
          direction="ltr" unicodeBidi="isolate"
        >
          {formatUnitValue(row.actual, model.spec.unit, ctx.formatters, { compact: true })}
        </text>
      ) : null}
      {rel !== null ? (
        <text
          x={row.actualX + row.actualW + 6}
          y={barCy + 14}
          dy="0.32em"
          className={`rf-chart-delta${relNeg ? " rf-chart-delta--neg" : " rf-chart-delta--pos"}`}
          direction="ltr" unicodeBidi="isolate"
        >
          {ctx.formatters.formatPercent(rel, { signDisplay: "exceptZero", maxFractionDigits: 1 })}
        </text>
      ) : null}
    </g>
  );
}

export function TargetBarsPlot({ ctx }: { ctx: PlotContext }) {
  const { model, strings } = ctx;
  const t = strings.t;
  const allKeys = useMemo(() => model.points.map((p) => p.key), [model]);
  const narrow = ctx.width < NARROW_SINGLE && model.points.length > 2;
  const [picked, setPicked] = useState<string | null>(null);
  const selectedKey = narrow ? (picked ?? ctx.emphasisKey ?? allKeys[0] ?? null) : null;
  const keys = narrow && selectedKey !== null ? [selectedKey] : allKeys;
  const labelCol = ctx.width < NARROW_SINGLE ? 96 : LABEL_COL;
  const layout = useMemo(() => layoutTarget(ctx, keys, labelCol), [ctx, keys, labelCol]);
  const height = keys.length * ROW_H + 26;
  const active = ctx.activeKey ? model.points.find((p) => p.key === ctx.activeKey) : null;

  return (
    <div className="rf-chart-plot rf-chart-plot--rows" {...ctx.explorerProps()}>
      {narrow ? (
        <div className="rf-chart-chips" role="group" aria-label={t("workspace.scope")}>
          {model.points.map((p) => (
            <button
              key={p.key}
              type="button"
              className="rf-chart-chip"
              aria-pressed={p.key === selectedKey}
              onClick={() => setPicked(p.key)}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="rf-chart-hgrid" style={{ gridTemplateColumns: `${labelCol}px minmax(0, 1fr)` }}>
        <div className="rf-chart-hlabels" aria-hidden="true" style={{ height }}>
          {keys.map((key) => {
            const p = model.points.find((pp) => pp.key === key)!;
            return (
              <div
                key={key}
                className="rf-chart-hlabel"
                data-emphasis={key === ctx.emphasisKey || undefined}
                style={{ height: ROW_H }}
                dir="auto"
              >
                {t(p.labelKey)}
              </div>
            );
          })}
          {unitAxisLabel(model.spec.unit, t) !== null ? (
            <div className="rf-chart-hunit" dir="ltr">
              {unitAxisLabel(model.spec.unit, t)}
            </div>
          ) : null}
        </div>
        <svg
          role="presentation"
          className="rf-chart-svg"
          width={ctx.width - labelCol}
          height={height}
          viewBox={`0 0 ${ctx.width - labelCol} ${height}`}
          direction="ltr" unicodeBidi="isolate"
        >
          <g aria-hidden="true">
            {layout.ticks.map(({ tick, x }) => (
              <line
                key={tick}
                x1={x}
                x2={x}
                y1={0}
                y2={height - 22}
                className="rf-chart-grid__line"
              />
            ))}
            {layout.labeledTicks.map(({ tick, cx, label }) => (
              <text key={tick} x={cx} y={height - 4} textAnchor="middle" className="rf-chart-tick" direction="ltr" unicodeBidi="isolate">
                {label}
              </text>
            ))}
            <line
              x1={layout.xOf(0)}
              x2={layout.xOf(0)}
              y1={0}
              y2={height - 22}
              className="rf-chart-zero"
            />
          </g>
          {layout.rows.map((row, i) => (
            <g key={row.key} {...ctx.datumProps(row.key)}>
              <HitTarget x={0} y={i * ROW_H} width={layout.plotWidth} height={ROW_H} />
              <RowContent ctx={ctx} row={row} rowY={i * ROW_H} emphasized={row.key === ctx.emphasisKey} width={layout.plotWidth} />
            </g>
          ))}
        </svg>
      </div>
      {active && layout.anchors[active.key] ? (
        <ChartTooltip anchor={layout.anchors[active.key]!} stageWidth={ctx.width}>
          <TooltipBody {...tooltipRows(active, model.series, ctx)} />
        </ChartTooltip>
      ) : null}
    </div>
  );
}
