/**
 * Localization seam for @rowfolio/charts.
 *
 * The package never imports @rowfolio/i18n — callers pass the already-bound
 * provider (or any structurally equivalent implementation) through props.
 * `@rowfolio/i18n`'s `I18n` satisfies `ChartStrings`/`ChartFormatters`
 * structurally: `t` accepts the catalog's message keys, and the `formatNumber`
 * family accepts the option subset declared here. `ChartNumberFormatOptions`
 * adds an optional `compact` hint for axis labels; adapters that do not
 * support it fall back to grouped notation — display stays exact either way.
 */
import type { Decimal, Unit } from "@rowfolio/contracts";
import { compareDecimal, multiplyDecimal, subtractDecimal } from "@rowfolio/contracts";
import { ChartError } from "./errors.ts";

export interface ChartNumberFormatOptions {
  scale?: number;
  minFractionDigits?: number;
  maxFractionDigits?: number;
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
  useGrouping?: boolean;
  /** Compact axis notation ("1.1M"); adapters may ignore — output stays exact. */
  compact?: boolean;
}

export interface ChartFormatters {
  formatNumber(value: Decimal | number, options?: ChartNumberFormatOptions): string;
  formatInteger(value: Decimal | number): string;
  formatPercent(value: Decimal | number, options?: ChartNumberFormatOptions): string;
  formatCurrency(value: Decimal | number, currency: string, options?: ChartNumberFormatOptions): string;
}

export interface ChartStrings {
  /** Message lookup by contract translation key. Placeholders are `{name}`. */
  t(key: string, params?: Readonly<Record<string, string>>): string;
  /**
   * Direction of the surrounding composition. Plot geometry (category order,
   * time axis, numeric axis) stays LTR in both locales per 06_I18N_ARABIC_SPEC —
   * never implement chart RTL via scaleX(-1).
   */
  direction: "ltr" | "rtl";
}

export interface ChartLocalization extends ChartStrings {
  formatters: ChartFormatters;
}

/**
 * Unit-aware value display. Formatting is presentation-only: canonical
 * decimal strings pass through to the caller's formatter unchanged.
 */
export function formatUnitValue(
  value: Decimal,
  unit: Unit,
  formatters: ChartFormatters,
  options?: ChartNumberFormatOptions,
): string {
  switch (unit.kind) {
    case "currency": {
      const currency = unit.currency;
      if (!currency) {
        return formatters.formatNumber(value, options);
      }
      return formatters.formatCurrency(value, currency, options);
    }
    case "ratio":
      return formatters.formatPercent(value, options);
    case "percentage-point":
      return formatters.formatNumber(value, { signDisplay: "exceptZero", ...options });
    case "count":
    case "minutes":
      return options?.compact
        ? formatters.formatNumber(value, options)
        : formatters.formatInteger(value);
    case "score":
    case "unknown":
      return formatters.formatNumber(value, options);
  }
}

/**
 * Signed difference of two chart values in display units. Uses the contract's
 * exact decimal arithmetic — this is a derived display quantity (axis labels
 * and the accessible table's variance columns), never a recomputed metric.
 * For `ratio` units the difference is expressed in percentage points.
 */
export function formatDelta(
  from: Decimal,
  to: Decimal,
  unit: Unit,
  formatters: ChartFormatters,
): { text: string; isNegative: boolean } {
  const diff = subtractCanonical(from, to);
  const negative = diff.startsWith("-");
  if (unit.kind === "ratio") {
    const pp = multiplyCanonical(diff, "100");
    return { text: `${formatters.formatNumber(pp, { signDisplay: "always", useGrouping: false })} pp`, isNegative: negative };
  }
  const text = unit.kind === "currency"
    ? formatters.formatCurrency(diff, unit.currency ?? "USD", { signDisplay: "always" })
    : formatters.formatNumber(diff, { signDisplay: "always" });
  return { text, isNegative: negative };
}

// Exact-arithmetic shims over the contract decimal surface. Charts never ship
// a math library object; these wrap the canonical-string helpers.
export function subtractCanonical(a: Decimal, b: Decimal): Decimal {
  return subtractDecimal(a, b);
}

export function multiplyCanonical(a: Decimal, b: Decimal): Decimal {
  return multiplyDecimal(a, b);
}

export function compareCanonical(a: Decimal, b: Decimal): number {
  return compareDecimal(a, b);
}

/** Canonical decimal → layout Number. Rejects non-finite wire input. */
export function decimalToNumber(value: Decimal): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ChartError("invalid-decimal", `Chart value is not finite: ${value}`, { value });
  }
  return n;
}
