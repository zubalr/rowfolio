/**
 * Typed errors for @rowfolio/charts.
 *
 * Charts consume already-validated contract objects; these errors fire when a
 * caller passes a spec that violates the wire contract's mandatory semantic
 * refinements (INTERFACES.md v1.0.0) — e.g. an inverted domain or a point
 * value under an undeclared series. They are programming errors, not user
 * input errors, and carry no source data.
 */

export type ChartErrorCode =
  | "invalid-domain"
  | "invalid-decimal"
  | "invalid-spec"
  | "unknown-series"
  | "empty-points";

export class ChartError extends Error {
  readonly code: ChartErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ChartErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ChartError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function isChartError(value: unknown): value is ChartError {
  return value instanceof ChartError;
}
