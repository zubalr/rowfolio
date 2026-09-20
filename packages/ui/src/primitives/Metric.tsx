/**
 * Metric — the unit-aware KPI primitive.
 *
 * Presentation-only: the caller (i18n/analysis layers) supplies the resolved
 * `label`, the already-formatted `value` display string and a localized
 * `reasonLabel` for undefined metrics. An undefined metric renders an explicit
 * "—" plus its reason — never a stale or invented number.
 *
 * `MetricStrip` lays metrics on one ruled strip (inline separators, no
 * floating cards) that wraps to two rows on small screens.
 */
import type { ReactNode } from "react";
import type { Unit } from "@rowfolio/contracts";
import { cx } from "../cx.ts";
import { Icon } from "../icons.tsx";

export type MetricDelta = {
  /** Pre-formatted signed display text, e.g. "+8%" — always an LTR island. */
  text: string;
  /** Semantic direction for assistive text and icon treatment. */
  direction: "up" | "down" | "flat";
  /**
   * `attention` is for genuine exceptions only; `positive`/`negative` carry
   * the standard hues; `neutral` is muted. Direction is also written into the
   * accessible label so color is never the only signal.
   */
  sentiment: "positive" | "negative" | "attention" | "neutral";
  /** Screen-reader wording, e.g. "increase". */
  srDirection?: string;
};

export interface MetricProps {
  /** Resolved, localized metric label. */
  label: string;
  /**
   * Formatted finite decimal display (Latin digits island) or null when the
   * metric is undefined. Raw `Decimal` strings belong to the i18n/analysis
   * layers — this component never reformats or recomputes values.
   */
  value: string | null;
  /** Contract unit — the label renders beside the value (e.g. "USD"). */
  unit?: Unit | undefined;
  status: "defined" | "undefined";
  /** Localized reason for an undefined metric (required when undefined). */
  reasonLabel?: string | undefined;
  delta?: MetricDelta | undefined;
  /** Optional trailing content, e.g. a "Show me why" evidence trigger. */
  footer?: ReactNode;
  size?: "rail" | "feature";
  testId?: string;
}

export function Metric({
  label,
  value,
  unit,
  status,
  reasonLabel,
  delta,
  footer,
  size = "rail",
  testId,
}: MetricProps) {
  if (status === "undefined" && !reasonLabel) {
    throw new MetricContractError(
      "Undefined metrics require a reasonLabel — the UI must explain the gap.",
    );
  }
  const deltaSentiment = delta?.sentiment ?? "neutral";
  return (
    <div className={cx("rf-metric", size === "feature" && "rf-metric--feature")} data-testid={testId}>
      <span className="rf-metric__label">{label}</span>
      {status === "defined" ? (
        <span className="rf-metric__value">
          <bdi dir="ltr" className="rf-numeric">
            {value}
          </bdi>
          {unit ? <bdi dir="ltr" className="rf-metric__unit">{unit.label}</bdi> : null}
        </span>
      ) : (
        <span className="rf-metric__value rf-metric__value--undefined" aria-label={reasonLabel}>
          —
        </span>
      )}
      {status === "undefined" ? (
        <p className="rf-metric__reason">
          <Icon name="info" size={16} aria-hidden="true" /> {reasonLabel}
        </p>
      ) : null}
      {delta && status === "defined" ? (
        <span
          className={cx("rf-metric__delta", `rf-metric__delta--${deltaSentiment}`)}
          aria-label={delta.srDirection ? `${delta.srDirection} ${delta.text}` : undefined}
        >
          <bdi dir="ltr">{delta.text}</bdi>
        </span>
      ) : null}
      {footer ? <div className="rf-metric__provenance">{footer}</div> : null}
    </div>
  );
}

export interface MetricStripProps {
  /** Group label announced to assistive tech (e.g. "Key metrics"). */
  label: string;
  children: ReactNode;
  testId?: string;
}

export function MetricStrip({ label, children, testId }: MetricStripProps) {
  return (
    <div className="rf-metric-strip" role="group" aria-label={label} data-testid={testId}>
      {children}
    </div>
  );
}

export class MetricContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricContractError";
  }
}
