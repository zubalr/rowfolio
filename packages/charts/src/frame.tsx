/**
 * ChartFigure — shared chrome for every chart kind: title, text summary,
 * "View values" toggle, keyboard datum explorer, tooltip plumbing and the
 * evidence table region. Per-kind components render only the plot itself.
 *
 * Accessibility contract (11_VISUALIZATION_SPEC): title + succinct summary
 * always present; keyboard moves through datum keys on ONE roving control
 * (the plot wrapper), tooltip opens on focus/pointer, Escape dismisses,
 * focus is never trapped, and a values table is one toggle away.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type { ChartSpec } from "@rowfolio/contracts";
import { prepareChart, type ChartModel } from "./model.ts";
import {
  formatUnitValue,
  type ChartFormatters,
  type ChartLocalization,
  type ChartStrings,
} from "./localization.ts";
import { useMeasure, useReducedMotion } from "./measure.ts";
import { ChartValuesTable } from "./values-table.tsx";
import { ChartError } from "./errors.ts";
import { BarsPlot } from "./plots/bars.tsx";
import { LinePlot } from "./plots/line.tsx";
import { ScenarioBarsPlot } from "./plots/scenario-bars.tsx";
import { TargetBarsPlot } from "./plots/target-bars.tsx";

export interface ChartFigureProps {
  spec: ChartSpec;
  /** Localization seam — @rowfolio/i18n's provider satisfies this structurally. */
  localization: ChartLocalization;
  /** Datum key to emphasize (the active finding's datum), if any. */
  emphasisKey?: string | undefined;
  /** Fallback width before the container is measured. */
  fallbackWidth?: number;
  /** Heading level for the chart title (default 3). */
  headingLevel?: 2 | 3 | 4;
  className?: string;
  testId?: string;
}

/** Context handed to each kind renderer. */
export interface PlotContext {
  model: ChartModel;
  strings: ChartStrings;
  formatters: ChartFormatters;
  /** Measured plot width in px. */
  width: number;
  /** Key of the pointer/keyboard-active datum. */
  activeKey: string | null;
  emphasisKey: string | null;
  reducedMotion: boolean;
  /** DOM id for a datum's option element (aria-activedescendant target). */
  datumId(key: string): string;
  /** Shared datum props: role/aria + pointer activation. */
  datumProps(key: string): {
    id: string;
    role: "option";
    "aria-selected": boolean;
    "data-active": boolean | undefined;
    "data-emphasis": boolean | undefined;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onClick: () => void;
  };
  /** Props for the roving explorer wrapper around the plot. */
  explorerProps(): {
    role: "listbox";
    tabIndex: number;
    "aria-label": string;
    "aria-activedescendant"?: string;
    onKeyDown: (e: ReactKeyboardEvent) => void;
    onFocus: () => void;
    onBlur: (e: React.FocusEvent) => void;
  };
}

/** Kind renderers receive the context and return the plot region content. */
export type PlotRenderer = (ctx: PlotContext) => ReactNode;

export function ChartFigure({ spec, localization, emphasisKey, fallbackWidth, headingLevel, className, testId }: ChartFigureProps) {
  const model = prepareChart(spec);
  const { ref, width } = useMeasure<HTMLDivElement>(fallbackWidth ?? 640);
  const reducedMotion = useReducedMotion();
  const [tableOpen, setTableOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const keys = model.points.map((p) => p.key);
  const t = localization.t;

  const describe = useCallback(
    (key: string): string => {
      const point = model.points.find((p) => p.key === key);
      if (!point) return "";
      const parts = model.series.map((s) => {
        const v = point.values.find((x) => x.seriesId === s.id);
        const text = v?.value == null ? t("common.notAvailable") : formatUnitValue(v.value, spec.unit, localization.formatters);
        return `${t(s.labelKey)} ${text}`;
      });
      return `${t(point.labelKey)}: ${parts.join(", ")}`;
    },
    [model, spec.unit, t, localization.formatters],
  );

  const activate = useCallback(
    (key: string | null) => {
      setActiveKey(key);
      if (liveTimer.current) clearTimeout(liveTimer.current);
      if (key !== null) {
        liveTimer.current = setTimeout(() => setAnnouncement(describe(key)), 60);
      }
    },
    [describe],
  );

  useEffect(() => () => {
    if (liveTimer.current) clearTimeout(liveTimer.current);
  }, []);

  const datumId = useCallback((key: string) => `rf-chart-${uid}-d-${key}`, [uid]);

  const onExplorerKeyDown = (e: ReactKeyboardEvent) => {
    const idx = activeKey === null ? -1 : keys.indexOf(activeKey);
    const next = (i: number) => activate(keys[((i % keys.length) + keys.length) % keys.length] ?? null);
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        next(idx < 0 ? 0 : idx + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        next(idx < 0 ? keys.length - 1 : idx - 1);
        break;
      case "Home":
        e.preventDefault();
        activate(keys[0] ?? null);
        break;
      case "End":
        e.preventDefault();
        activate(keys[keys.length - 1] ?? null);
        break;
      case "Escape":
        e.preventDefault();
        activate(null);
        break;
    }
  };

  const ctx: PlotContext = {
    model,
    strings: localization,
    formatters: localization.formatters,
    width,
    activeKey,
    emphasisKey: emphasisKey ?? null,
    reducedMotion,
    datumId,
    datumProps: (key) => ({
      id: datumId(key),
      role: "option",
      "aria-selected": activeKey === key,
      "data-active": activeKey === key ? true : undefined,
      "data-emphasis": emphasisKey === key ? true : undefined,
      onPointerEnter: () => activate(key),
      onPointerLeave: () => activate(null),
      onClick: () => activate(key),
    }),
    explorerProps: () => ({
      role: "listbox",
      tabIndex: 0,
      "aria-label": `${t(spec.titleKey)} — ${t(spec.summaryKey)}`,
      ...(activeKey !== null ? { "aria-activedescendant": datumId(activeKey) } : {}),
      onKeyDown: onExplorerKeyDown,
      onFocus: () => {
        if (activeKey === null) activate(emphasisKey ?? keys[0] ?? null);
      },
      onBlur: (e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) activate(null);
      },
    }),
  };

  const Heading = `h${headingLevel ?? 3}` as const;
  const renderer = PLOTS[spec.kind];
  if (!renderer) {
    throw new ChartError("invalid-spec", `No renderer for chart kind ${spec.kind}`, { kind: spec.kind });
  }

  return (
    <figure
      ref={ref}
      className={`rf-chart${className ? ` ${className}` : ""}`}
      dir={localization.direction}
      data-kind={spec.kind}
      data-testid={testId}
    >
      <figcaption className="rf-chart__caption">
        <Heading className="rf-chart__title">{t(spec.titleKey)}</Heading>
        <p className="rf-chart__summary">{t(spec.summaryKey)}</p>
      </figcaption>
      <div className="rf-chart__toolbar">
        <button
          type="button"
          className="rf-chart__toggle"
          aria-expanded={tableOpen}
          aria-controls={`rf-chart-${uid}-table`}
          onClick={() => setTableOpen((v) => !v)}
        >
          {t("action.viewData")}
        </button>
      </div>
      <div className="rf-chart__stage">{renderer(ctx)}</div>
      <span className="rf-visually-hidden" aria-live="polite">
        {announcement}
      </span>
      {tableOpen ? (
        <div id={`rf-chart-${uid}-table`} className="rf-chart__values">
          <ChartValuesTable model={model} localization={localization} />
        </div>
      ) : null}
    </figure>
  );
}

const PLOTS: Record<ChartSpec["kind"], PlotRenderer> = {
  "target-bars": (ctx) => <TargetBarsPlot ctx={ctx} />,
  line: (ctx) => <LinePlot ctx={ctx} />,
  bars: (ctx) => <BarsPlot ctx={ctx} variant="default" />,
  "quality-bars": (ctx) => <BarsPlot ctx={ctx} variant="quality" />,
  "scenario-bars": (ctx) => <ScenarioBarsPlot ctx={ctx} />,
  distribution: (ctx) => <BarsPlot ctx={ctx} variant="distribution" />,
};
