/**
 * Status — live-region announcements and steady states.
 *
 * Blocking errors use role="alert"; everything else is a polite role="status"
 * so completed stages announce once rather than chattering. `loading` accepts
 * the named stage list from the motion spec — real stage transitions, never a
 * fabricated percentage. `empty` is the no-data/no-findings surface.
 */
import type { ReactNode } from "react";
import { cx } from "../cx.ts";
import { Icon, type IconName } from "../icons.tsx";

export type StatusKind =
  | "loading"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "empty";

export interface StatusStage {
  /** Stable id and already-localized label, e.g. "parse" / "Parse sheet". */
  id: string;
  label: string;
}

export interface StatusProps {
  kind: StatusKind;
  /** Short headline — localized. */
  title: string;
  /** Optional supporting sentence. */
  children?: ReactNode;
  /** Named processing stages (kind="loading"). */
  stages?: readonly StatusStage[];
  /** id of the in-flight stage; earlier stages render as done. */
  currentStage?: string;
  /** Action row, e.g. a Cancel button. */
  actions?: ReactNode;
  testId?: string;
}

const KIND_ICON: Record<StatusKind, IconName> = {
  loading: "info",
  success: "check",
  warning: "warning",
  error: "warning",
  info: "info",
  empty: "info",
};

export function Status({
  kind,
  title,
  children,
  stages,
  currentStage,
  actions,
  testId,
}: StatusProps) {
  const role = kind === "error" ? "alert" : "status";
  const currentIndex = stages?.findIndex((s) => s.id === currentStage) ?? -1;
  return (
    <div
      className={cx("rf-status", `rf-status--${kind}`)}
      role={role}
      aria-live={role === "status" ? "polite" : undefined}
      data-testid={testId}
    >
      {kind === "loading" ? (
        <span className="rf-loader" aria-hidden="true">
          <span className="rf-loader__fill" />
        </span>
      ) : (
        <span className="rf-status__icon" aria-hidden="true">
          <Icon name={KIND_ICON[kind]} />
        </span>
      )}
      <div>
        <p className="rf-status__title">{title}</p>
        {children ? <div className="rf-status__body">{children}</div> : null}
        {stages && stages.length > 0 ? (
          <ol className="rf-status__stages">
            {stages.map((stage, i) => (
              <li
                key={stage.id}
                className="rf-status__stage"
                data-state={
                  i < currentIndex ? "done" : i === currentIndex ? "current" : "pending"
                }
              >
                {stage.label}
              </li>
            ))}
          </ol>
        ) : null}
        {actions ? <div className="rf-status__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
