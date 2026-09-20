/**
 * Small assistive primitives:
 *  - VisuallyHidden — content announced but not rendered visually.
 *  - Bidi — direction isolation for user-authored text (`dir="auto"`) and
 *    Latin islands (`dir="ltr"`: source IDs, formulas, signed numerics,
 *    ISO dates), per the localization contract.
 *  - SkipLink — visible-on-focus link that jumps to the main region.
 */
import type { ReactNode } from "react";
import { cx } from "../cx.ts";

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="rf-visually-hidden">{children}</span>;
}

export interface BidiProps {
  /** "ltr" pins numeric/source islands; "auto" for user-authored strings. */
  dir: "ltr" | "auto";
  children: ReactNode;
  className?: string;
}

export function Bidi({ dir, children, className }: BidiProps) {
  return (
    <bdi dir={dir} className={cx("rf-bidi", className)}>
      {children}
    </bdi>
  );
}

export interface SkipLinkProps {
  /** id of the main region, including "#". */
  targetId: string;
  children: ReactNode;
}

export function SkipLink({ targetId, children }: SkipLinkProps) {
  return (
    <a className="rf-skip" href={targetId}>
      {children}
    </a>
  );
}
