/**
 * Line plot — discrete reporting-period trend. Straight segments only (no
 * spline smoothing that would suggest unobserved data), points in declared
 * chronological order on an LTR axis in both locales, and direct value
 * annotations at each period.
 */
import { useMemo } from "react";
import { line as d3line } from "d3-shape";
import type { PlotContext } from "../frame.tsx";
import { formatUnitValue } from "../localization.ts";
import { ordinalPosition, valueScale } from "../scales.ts";
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

const MARGIN = { top: 30, end: 24, bottom: 30, start: 56 };
const HEIGHT = 280;
const MAX_DIRECT_LABELS = 8;

interface SeriesPath {
  seriesId: string;
  d: string;
  paint: { fill: string; stroke: string; dashed: boolean };
}

interface LineLayout {
  paths: SeriesPath[];
  cx: Record<string, number>;
  cy: Record<string, Record<string, number>>;
  anchors: Record<string, DatumAnchor>;
  yOf: (v: number) => number;
  plotWidth: number;
  height: number;
  step: number;
}

export function layoutLine(ctx: PlotContext): LineLayout {
  const { model, width } = ctx;
  const keys = model.points.map((p) => p.key);
  const plotWidth = Math.max(width - MARGIN.start - MARGIN.end, 60);
  const x = ordinalPosition(keys, [12, plotWidth - 12], 0.4);
  const y = valueScale(model.domain, [HEIGHT - MARGIN.bottom, MARGIN.top]);
  const cx: Record<string, number> = {};
  const cy: Record<string, Record<string, number>> = {};
  const anchors: Record<string, DatumAnchor> = {};
  for (const p of model.points) {
    cx[p.key] = x(p.key) ?? 0;
    cy[p.key] = {};
    let top = HEIGHT - MARGIN.bottom;
    for (const s of model.series) {
      const v = p.values.find((vv) => vv.seriesId === s.id)?.coordinate;
      if (v != null) {
        cy[p.key]![s.id] = y(v);
        top = Math.min(top, y(v));
      }
    }
    anchors[p.key] = { x: cx[p.key]!, y: top };
  }
  const paths: SeriesPath[] = model.series.map((s) => {
    const gen = d3line<{ x: number; y: number | null }>()
      .x((d) => d.x)
      .y((d) => d.y ?? 0)
      .defined((d) => d.y !== null);
    const pts = model.points.map((p) => ({
      x: cx[p.key]!,
      y: p.values.find((v) => v.seriesId === s.id)?.coordinate ?? null,
    }));
    return { seriesId: s.id, d: gen(pts) ?? "", paint: paintFor(s.semantic) };
  });
  return { paths, cx, cy, anchors, yOf: y, plotWidth, height: HEIGHT, step: x.step() };
}

export function LinePlot({ ctx }: { ctx: PlotContext }) {
  const { model, strings } = ctx;
  const layout = useMemo(() => layoutLine(ctx), [ctx]);
  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of model.points) out[p.key] = strings.t(p.labelKey);
    return out;
  }, [model, strings]);
  const showAllLabels = model.points.length <= MAX_DIRECT_LABELS;
  const labeled = useMemo(() => {
    if (showAllLabels) return new Set(model.points.map((p) => p.key));
    const keep = new Set<string>();
    const pts = model.points;
    if (pts.length) {
      keep.add(pts[0]!.key);
      keep.add(pts[pts.length - 1]!.key);
    }
    let minK: string | null = null;
    let maxK: string | null = null;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of pts) {
      for (const v of p.values) {
        if (v.coordinate == null) continue;
        if (v.coordinate < minV) {
          minV = v.coordinate;
          minK = p.key;
        }
        if (v.coordinate > maxV) {
          maxV = v.coordinate;
          maxK = p.key;
        }
      }
    }
    if (minK) keep.add(minK);
    if (maxK) keep.add(maxK);
    if (ctx.emphasisKey) keep.add(ctx.emphasisKey);
    return keep;
  }, [model, showAllLabels, ctx.emphasisKey]);
  const active = ctx.activeKey ? model.points.find((p) => p.key === ctx.activeKey) : null;

  return (
    <div className="rf-chart-plot" {...ctx.explorerProps()}>
      <svg
        role="presentation"
        className="rf-chart-svg"
        width={ctx.width}
        height={layout.height}
        viewBox={`0 0 ${ctx.width} ${layout.height}`}
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
          />
          {layout.paths.map((path) => (
            <path
              key={path.seriesId}
              d={path.d}
              fill="none"
              style={{ stroke: path.paint.stroke }}
              strokeWidth={2}
              strokeDasharray={path.paint.dashed ? "6 4" : undefined}
              pathLength={path.paint.dashed ? undefined : 1}
              strokeLinejoin="round"
              strokeLinecap="round"
              className={`rf-chart-line${path.paint.dashed ? "" : " rf-chart-line--draw"}`}
            />
          ))}
          {model.points.map((p) => (
            <g key={p.key} {...ctx.datumProps(p.key)}>
              <HitTarget
                x={layout.cx[p.key]! - 22}
                y={MARGIN.top - 20}
                width={44}
                height={layout.height - MARGIN.top - MARGIN.bottom + 20}
              />
              {model.series.map((s, si) => {
                const yy = layout.cy[p.key]?.[s.id];
                const resolved = p.values.find((v) => v.seriesId === s.id);
                if (yy === undefined) {
                  return (
                    <text
                      key={s.id}
                      x={layout.cx[p.key]!}
                      y={layout.height - MARGIN.bottom - 6}
                      textAnchor="middle"
                      className="rf-chart-missing"
                    >
                      —
                    </text>
                  );
                }
                const paint = paintFor(s.semantic);
                const emphasized = p.key === ctx.emphasisKey;
                return (
                  <g key={s.id}>
                    {emphasized ? (
                      <circle
                        cx={layout.cx[p.key]!}
                        cy={yy}
                        r={9}
                        className="rf-chart-ring"
                      />
                    ) : null}
                    <circle
                      cx={layout.cx[p.key]!}
                      cy={yy}
                      r={ctx.activeKey === p.key || emphasized ? 5.5 : 4}
                      style={{
                        fill: s.semantic === "observed" ? paint.stroke : "var(--rf-c-surface)",
                        stroke: paint.stroke,
                      }}
                      strokeWidth={emphasized ? 2.5 : 2}
                      className="rf-chart-point"
                    />
                    {labeled.has(p.key) && si === 0 ? (
                      <text
                        x={layout.cx[p.key]!}
                        y={yy - 10}
                        textAnchor="middle"
                        className="rf-chart-value"
                        direction="ltr" unicodeBidi="isolate"
                      >
                        {resolved?.value != null
                          ? formatUnitValue(resolved.value, model.spec.unit, ctx.formatters, {
                              compact: ctx.width < 480,
                            })
                          : ""}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          ))}
          <CategoryAxis keys={model.points.map((p) => p.key)} xOf={(k) => layout.cx[k] ?? 0} y={layout.height - 8} labels={labels} maxWidth={Math.max(layout.step - 6, 40)} emphasisKey={ctx.emphasisKey} />
        </g>
      </svg>
      {model.series.length > 1 ? (
        <ul className="rf-chart-legend" aria-hidden="true">
          {model.series.map((s) => (
            <li key={s.id} data-semantic={s.semantic}>
              <span className="rf-chart-legend__swatch" data-semantic={s.semantic} />
              {strings.t(s.labelKey)}
            </li>
          ))}
        </ul>
      ) : null}
      {active && layout.anchors[active.key] ? (
        <ChartTooltip anchor={layout.anchors[active.key]!} stageWidth={ctx.width}>
          <TooltipBody {...tooltipRows(active, model.series, ctx)} />
        </ChartTooltip>
      ) : null}
    </div>
  );
}
