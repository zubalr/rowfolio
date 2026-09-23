/**
 * @rowfolio/charts — art-directed, evidence-ready charts for Rowfolio.
 *
 * React owns the DOM; the selective D3 utilities (d3-scale/d3-shape/d3-array)
 * produce geometry only. Every component renders from the immutable contract
 * `ChartSpec` (contracts v1.0.0): canonical decimal values, declared domain,
 * point keys and label/provenance IDs. Nothing here recomputes business
 * metrics — the only derived numbers are display deltas computed with the
 * contract's exact decimal arithmetic.
 *
 * Consumers pass the localization seam (`ChartLocalization`) — satisfied
 * structurally by `@rowfolio/i18n`'s provider — so this package needs no
 * i18n dependency. Plot geometry stays LTR in both locales while surrounding
 * composition, text and alignment follow `direction` (06_I18N_ARABIC_SPEC).
 */
import "./styles.css";

export { ChartFigure } from "./frame.tsx";
export type { ChartFigureProps, PlotContext } from "./frame.tsx";

export { ChartValuesTable } from "./values-table.tsx";

export {
  prepareChart,
  chartTicks,
  pointKeys,
  absoluteVariance,
  relativeVariance,
} from "./model.ts";
export type {
  ChartModel,
  ResolvedPoint,
  ResolvedSeries,
  ResolvedValue,
} from "./model.ts";

export {
  formatUnitValue,
  formatDelta,
  subtractCanonical,
  multiplyCanonical,
  compareCanonical,
  decimalToNumber,
} from "./localization.ts";
export type {
  ChartFormatters,
  ChartLocalization,
  ChartNumberFormatOptions,
  ChartStrings,
} from "./localization.ts";

export { ChartError, isChartError } from "./errors.ts";
export type { ChartErrorCode } from "./errors.ts";

export { CHART_COLORS } from "./plots/shared.tsx";
