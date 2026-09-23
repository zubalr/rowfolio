/**
 * Shared plot primitives: token paints by series semantic, hand-built axes
 * and gridlines (per spec — axes are not delegated to D3 axis generators),
 * datum hit targets and the HTML tooltip overlay.
 */
import type { CSSProperties, ReactNode } from "react";
import { DESIGN_TOKENS, type Unit } from "@rowfolio/contracts";
import type { PlotContext } from "../frame.tsx";
import { formatUnitValue, type ChartFormatters } from "../localization.ts";
import type { ResolvedPoint, ResolvedSeries } from "../model.ts";

export const CHART_COLORS = DESIGN_TOKENS.color;

/**
 * Series paint by declared semantic — the deliberate hierarchy. Paints are
 * CSS custom properties (applied through `style`, not paint attributes) so a
 * chart mounted on `[data-rf-surface="ink"]` adopts the ink palette through
 * the scoped `--rf-c-*` remap without a second code path.
 */
export function paintFor(semantic: ResolvedSeries["semantic"]): {
  fill: string;
  stroke: string;
  dashed: boolean;
} {
  switch (semantic) {
    case "observed":
      return { fill: "var(--rf-c-data)", stroke: "var(--rf-c-data)", dashed: false };
    case "target":
      return { fill: "var(--rf-c-ink)", stroke: "var(--rf-c-ink)", dashed: true };
    case "scenario":
      return { fill: "none", stroke: "var(--rf-c-scenario)", dashed: true };
    case "attention":
      return { fill: "var(--rf-c-attention)", stroke: "var(--rf-c-attention)", dashed: false };
  }
}

/** Engine-emitted unit labels that carry catalog translations. */
const UNIT_LABEL_KEYS: Record<string, string> = {
  records: "unit.records",
};

/** Short axis caption for the declared unit; null when the unit is opaque.
 *  Pass `t` so engine labels with catalog keys ("records") localize. */
export function unitAxisLabel(unit: Unit, t?: (key: string) => string): string | null {
  switch (unit.kind) {
    case "currency":
      return unit.currency;
    case "ratio":
      return "%";
    case "percentage-point":
      return "pp";
    case "unknown":
      return null;
    default: {
      const label = unit.label.trim();
      if (label === "" || label === "unit" || label === "fraction") return null;
      const key = UNIT_LABEL_KEYS[label];
      return key !== undefined && t !== undefined ? t(key) : label;
    }
  }
}

export interface PlotMargins {
  top: number;
  end: number;
  bottom: number;
  start: number;
}

export const TICK_FONT = 12;
export const LABEL_FONT = 13;

/** Horizontal gridlines + end-aligned value tick labels (y axis, LTR). */
export function ValueGrid(props: {
  ticks: readonly number[];
  yOf: (v: number) => number;
  x0: number;
  x1: number;
  unit: Unit;
  formatters: ChartFormatters;
  /** Message lookup for localizable unit labels (e.g. "records"). */
  t?: (key: string) => string;
}) {
  const { ticks, yOf, x0, x1, unit, formatters, t } = props;
  return (
    <g className="rf-chart-grid" aria-hidden="true">
      {ticks.map((tick) => {
        const y = yOf(tick);
        return (
          <g key={tick}>
            <line x1={x0} x2={x1} y1={y} y2={y} className="rf-chart-grid__line" />
            <text
              x={x0 - 8}
              y={y}
              dy="0.32em"
              textAnchor="end"
              className="rf-chart-tick"
            >
              {formatAxisTick(tick, unit, formatters)}
            </text>
          </g>
        );
      })}
      {unitAxisLabel(unit, t) !== null ? (
        <text x={x0 - 8} y={12} textAnchor="end" className="rf-chart-unit">
          {unitAxisLabel(unit, t)}
        </text>
      ) : null}
    </g>
  );
}

export function formatAxisTick(value: number, unit: Unit, formatters: ChartFormatters): string {
  const text = String(value);
  return formatUnitValue(text, unit, formatters, { compact: true });
}

/**
 * Word-wrap an axis label to at most `maxLines` lines of `maxWidth` px.
 * Long labels wrap rather than shrink or clip mid-glyph; an ellipsis marks
 * truncation and the full label stays available via the datum tooltip/table.
 */
export function wrapAxisLabel(
  label: string,
  maxWidth: number,
  maxLines = 2,
): string[] {
  const charPx = 6.4; // conservative width per char at 12px for EN and AR
  const maxChars = Math.max(3, Math.floor(maxWidth / charPx));
  if (label.length <= maxChars) return [label];
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (lines.length === maxLines) break;
    current = word;
    // hard-split a word that alone exceeds a line
    while (current.length > maxChars && lines.length < maxLines) {
      lines.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  const consumed = lines.join(" ").length;
  if (consumed < label.length) {
    const last = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`;
  }
  return lines;
}

/** Category labels under a vertical chart (x axis, chronological LTR). */
export function CategoryAxis(props: {
  keys: readonly string[];
  xOf: (key: string) => number;
  y: number;
  labels: Record<string, string>;
  /** Per-category pixel budget (band or step width) used to wrap labels. */
  maxWidth: number;
  /** Datum key to bold (the emphasized selection), if any. */
  emphasisKey?: string | null;
}) {
  const { keys, xOf, y, labels, maxWidth, emphasisKey } = props;
  return (
    <g className="rf-chart-cats" aria-hidden="true">
      {keys.map((key) => {
        const lines = wrapAxisLabel(labels[key] ?? key, maxWidth);
        const firstY = y - (lines.length - 1) * 6;
        return (
          <text
            key={key}
            x={xOf(key)}
            y={firstY}
            textAnchor="middle"
            className="rf-chart-cat"
            data-emphasis={key === emphasisKey ? true : undefined}
            direction="auto"
          >
            {lines.map((line, i) => (
              <tspan key={i} x={xOf(key)} dy={i === 0 ? 0 : 11}>
                {line}
              </tspan>
            ))}
          </text>
        );
      })}
    </g>
  );
}

/** Transparent ≥44px hit target so touch/pointer selection never needs precision. */
export function HitTarget(props: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const { x, y, width, height } = props;
  const w = Math.max(width, 44);
  const h = Math.max(height, 44);
  return (
    <rect
      x={x - (w - width) / 2}
      y={y - (h - height) / 2}
      width={w}
      height={h}
      fill="transparent"
      pointerEvents="all"
    />
  );
}

export interface DatumAnchor {
  /** Tooltip anchor in stage pixels (center of the datum's visual top). */
  x: number;
  y: number;
}

/** HTML tooltip overlay; positioned at the datum anchor, clamped to stage. */
export function ChartTooltip(props: {
  anchor: DatumAnchor;
  stageWidth: number;
  children: ReactNode;
}) {
  const { anchor, stageWidth, children } = props;
  const half = Math.min(110, stageWidth / 2 - 8);
  const x = Math.min(Math.max(anchor.x, half + 8), Math.max(half + 8, stageWidth - half - 8));
  const style: CSSProperties = { insetInlineStart: x, bottom: `calc(100% - ${anchor.y}px + 8px)` };
  return (
    <div className="rf-chart-tip" role="status" style={style}>
      {children}
    </div>
  );
}

export function tooltipRows(
  point: ResolvedPoint,
  modelSeries: readonly ResolvedSeries[],
  ctx: PlotContext,
): { label: string; rows: { series: string; value: string; semantic: string }[] } {
  const t = ctx.strings.t;
  return {
    label: t(point.labelKey),
    rows: modelSeries.map((s) => {
      const v = point.values.find((x) => x.seriesId === s.id);
      return {
        series: t(s.labelKey),
        value:
          v?.value == null
            ? t("common.notAvailable")
            : formatUnitValue(v.value, ctx.model.spec.unit, ctx.formatters),
        semantic: s.semantic,
      };
    }),
  };
}

export function TooltipBody({ label, rows }: ReturnType<typeof tooltipRows>) {
  return (
    <>
      <div className="rf-chart-tip__label" dir="auto">
        {label}
      </div>
      {rows.map((r) => (
        <div key={r.series} className="rf-chart-tip__row">
          <span>{r.series}</span>
          <bdi dir="ltr" className="rf-chart-tip__value">
            {r.value}
          </bdi>
        </div>
      ))}
    </>
  );
}
