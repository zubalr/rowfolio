/**
 * Vertical bar plots: `bars` (period comparisons like downtime),
 * `quality-bars` (issue ledger) and `distribution` (bins). Zero baseline is
 * mandatory; grouped series sit side-by-side inside each category band;
 * values label every bar directly so nothing depends on reading pixels.
 */
import { useMemo } from "react";
import type { PlotContext } from "../frame.tsx";
import { formatUnitValue } from "../localization.ts";
import { categoryScale, valueScale } from "../scales.ts";
import {
  CategoryAxis,
  ChartTooltip,
  HitTarget,
  TooltipBody,
  ValueGrid,
  paintFor,
  tooltipRows,
  type DatumAnchor,
} from "./shared.tsx";

const MARGIN = { top: 30, end: 16, bottom: 30, start: 56 };
const HEIGHT = 280;

export type BarsVariant = "default" | "quality" | "distribution";

interface BarMark {
  x: number;
  y: number;
  width: number;
  height: number;
  valueY: number;
  value: string | null;
  negative: boolean;
  paint: { fill: string; stroke: string; dashed: boolean };
}

interface BarsLayout {
  marks: Record<string, BarMark[]>;
  catX: Record<string, number>;
  anchors: Record<string, DatumAnchor>;
  yOf: (v: number) => number;
  zeroY: number;
  svgHeight: number;
  plotWidth: number;
  bandWidth: number;
}

function fillFor(ctx: PlotContext, variant: BarsVariant, seriesIdx: number, pointKey: string, isLast: boolean) {
  const series = ctx.model.series[seriesIdx]!;
  if (variant === "default" && ctx.model.series.length === 1 && series.semantic === "observed") {
    // Chronological comparison hierarchy: the latest period is cobalt;
    // earlier periods step back to muted ink rather than competing hues.
    const emphasize = ctx.emphasisKey ? pointKey === ctx.emphasisKey : isLast;
    return { fill: emphasize ? "var(--rf-c-data)" : "var(--rf-c-muted)", stroke: "none", dashed: false };
  }
  return paintFor(series.semantic);
}

export function layoutBars(ctx: PlotContext, variant: BarsVariant): BarsLayout {
  const { model, width } = ctx;
  const keys = model.points.map((p) => p.key);
  const plotWidth = Math.max(width - MARGIN.start - MARGIN.end, 60);
  const x = categoryScale(keys, [0, plotWidth], keys.length > 6 ? 0.18 : 0.3);
  const y = valueScale(model.domain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
  const zeroY = y(Math.max(0, Math.min(model.domain.max, Math.max(model.domain.min, 0))));
  const series = model.series;
  const innerWidth = x.bandwidth();
  const groupW = innerWidth / series.length;
  const marks: Record<string, BarMark[]> = {};
  const catX: Record<string, number> = {};
  const anchors: Record<string, DatumAnchor> = {};
  for (const p of model.points) {
    const bandX = x(p.key) ?? 0;
    catX[p.key] = bandX + innerWidth / 2;
    const list: BarMark[] = [];
    let topY = zeroY;
    series.forEach((s, si) => {
      const resolved = p.values.find((v) => v.seriesId === s.id);
      const v = resolved?.coordinate;
      if (v == null) {
        list.push({
          x: bandX + si * groupW,
          y: zeroY,
          width: Math.max(groupW - 4, 4),
          height: 0,
          valueY: zeroY - 6,
          value: null,
          negative: false,
          paint: fillFor(ctx, variant, si, p.key, p.key === keys[keys.length - 1]),
        });
        return;
      }
      const vy = y(v);
      const top = Math.min(vy, zeroY);
      const h = Math.max(Math.abs(zeroY - vy), 1);
      topY = Math.min(topY, top);
      list.push({
        x: bandX + si * groupW,
        y: top,
        width: Math.max(groupW - 4, 4),
        height: h,
        valueY: top - 6,
        value: resolved!.value,
        negative: v < 0,
        paint: fillFor(ctx, variant, si, p.key, p.key === keys[keys.length - 1]),
      });
    });
    marks[p.key] = list;
    anchors[p.key] = { x: bandX + innerWidth / 2, y: topY };
  }
  return { marks, catX, anchors, yOf: y, zeroY, svgHeight: HEIGHT, plotWidth, bandWidth: innerWidth };
}

export function BarsPlot({ ctx, variant }: { ctx: PlotContext; variant: BarsVariant }) {
  const { model, strings } = ctx;
  const layout = useMemo(() => layoutBars(ctx, variant), [ctx, variant]);
  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of model.points) out[p.key] = strings.t(p.labelKey);
    return out;
  }, [model, strings]);
  const active = ctx.activeKey ? model.points.find((p) => p.key === ctx.activeKey) : null;
  // Direct value labels collide only when each series slot is narrower than
  // the label — then the emphasized datum keeps its label and the rest defer
  // to the tooltip and the values table rather than overlapping.
  const dense = layout.bandWidth / Math.max(1, model.series.length) < 30;

  return (
    <div className="rf-chart-plot" {...ctx.explorerProps()}>
      <svg
        role="presentation"
        className="rf-chart-svg"
        width={ctx.width}
        height={layout.svgHeight}
        viewBox={`0 0 ${ctx.width} ${layout.svgHeight}`}
        direction="ltr" unicodeBidi="isolate"
      >
        <g transform={`translate(${MARGIN.start},0)`}>
          <ValueGrid
            ticks={model.ticks}
            yOf={layout.yOf}
            x0={0}
            x1={layout.plotWidth}
            unit={model.spec.unit}
            formatters={ctx.formatters}
            t={ctx.strings.t}
          />
          <line
            x1={0}
            x2={layout.plotWidth}
            y1={layout.zeroY}
            y2={layout.zeroY}
            className="rf-chart-zero"
          />
          {model.points.map((p) => (
            <g key={p.key} {...ctx.datumProps(p.key)}>
              <HitTarget
                x={layout.catX[p.key]! - 22}
                y={MARGIN.top - 20}
                width={44}
                height={layout.svgHeight - MARGIN.top - MARGIN.bottom + 20}
              />
              {(layout.marks[p.key] ?? []).map((m, i) =>
                m.value === null ? (
                  <text
                    key={i}
                    x={m.x + m.width / 2}
                    y={layout.zeroY - 6}
                    textAnchor="middle"
                    className="rf-chart-missing"
                  >
                    —
                  </text>
                ) : (
                  <g key={i}>
                    <rect
                      x={m.x}
                      y={m.y}
                      width={m.width}
                      height={m.height}
                      style={{
                        fill: m.paint.fill,
                        ...(m.paint.dashed ? { stroke: m.paint.stroke } : {}),
                      }}
                      stroke={m.paint.dashed ? undefined : "none"}
                      strokeDasharray={m.paint.dashed ? "5 3" : undefined}
                      strokeWidth={m.paint.dashed ? 1.5 : 0}
                      data-neg={m.negative || undefined}
                      rx={2}
                      className="rf-chart-bar"
                    />
                    {p.key === ctx.emphasisKey && m.height >= 2 ? (
                      <rect
                        className="rf-chart-cellsel"
                        x={m.x + 1}
                        y={m.y + 1}
                        width={Math.max(m.width - 2, 0)}
                        height={Math.max(m.height - 2, 0)}
                        rx={1}
                      />
                    ) : null}
                    {p.key === ctx.emphasisKey && m.height >= 20 ? (
                      <path
                        className="rf-chart-mark"
                        transform={`translate(${m.x + m.width / 2}, ${m.y + 3})`}
                        d="M -4 0 L 0 6 L 4 0 Z"
                      />
                    ) : null}
                    {dense && p.key !== ctx.emphasisKey && p.key !== ctx.activeKey ? null : p.key ===
                      ctx.emphasisKey ? (
                      <EmphasisValueLabel
                        x={m.x + m.width / 2}
                        y={m.valueY}
                        text={formatUnitValue(m.value, model.spec.unit, ctx.formatters, {
                          compact: ctx.width < 480,
                        })}
                      />
                    ) : (
                      <text
                        x={m.x + m.width / 2}
                        y={m.valueY}
                        textAnchor="middle"
                        className="rf-chart-value"
                        direction="ltr" unicodeBidi="isolate"
                      >
                        {formatUnitValue(m.value, model.spec.unit, ctx.formatters, { compact: ctx.width < 480 })}
                      </text>
                    )}
                  </g>
                ),
              )}
            </g>
          ))}
          <CategoryAxis keys={model.points.map((p) => p.key)} xOf={(k) => layout.catX[k] ?? 0} y={layout.svgHeight - 8} labels={labels} maxWidth={layout.bandWidth + 12} emphasisKey={ctx.emphasisKey} />
        </g>
      </svg>
      {active && layout.anchors[active.key] ? (
        <ChartTooltip anchor={layout.anchors[active.key]!} stageWidth={ctx.width}>
          <TooltipBody {...tooltipRows(active, model.series, ctx)} />
        </ChartTooltip>
      ) : null}
    </div>
  );
}

/** The selected datum's value label: an ink chip so it reads first, on any bar color. */
function EmphasisValueLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const chipW = Math.max(30, text.length * 7.4 + 14);
  return (
    <g className="rf-chart-emph-label">
      <rect
        className="rf-chart-valuechip"
        x={x - chipW / 2}
        y={y - 13.5}
        width={chipW}
        height={17}
        rx={5}
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        className="rf-chart-value rf-chart-value--chip"
        direction="ltr" unicodeBidi="isolate"
      >
        {text}
      </text>
    </g>
  );
}
