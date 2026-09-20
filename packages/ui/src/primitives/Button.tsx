/**
 * Button — the action primitive.
 *
 * Variants follow 04_DESIGN_SYSTEM.md exactly: solid ink primary, transparent
 * secondary with underline/arrow affordance on hover, and vermilion attention
 * used sparingly for genuine exceptions (its label uses the text-grade
 * `negative` token because attention-on-paper is a large-text pair only).
 *
 * Icon-only buttons require `label` — it becomes the accessible name and the
 * visible tooltip (title). Minimum height is the 44px control token.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../cx.ts";
import { Icon, type IconName } from "../icons.tsx";

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "children"
> {
  variant?: "primary" | "secondary" | "attention";
  /** Leading icon (never mirrored-sensitive unless the glyph is directional). */
  icon?: IconName;
  /** Trailing icon — `arrow-end` mirrors in RTL automatically. */
  iconEnd?: IconName;
  /** Visible text. Optional only when `label` (accessible name) is present. */
  children?: ReactNode;
  /**
   * Accessible name for icon-only buttons. Required when `children` is absent;
   * also renders as the tooltip via `title`.
   */
  label?: string;
  /** Stretch to fill the container (full-width mobile actions). */
  block?: boolean;
  className?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", icon, iconEnd, children, label, block, className, type = "button", ...rest },
  ref,
) {
  const iconOnly = children === undefined;
  if (iconOnly && !label) {
    throw new UiPrimitiveError(
      "Icon-only Button requires `label` for an accessible name.",
    );
  }
  return (
    <button
      ref={ref}
      type={type}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      className={cx(
        "rf-btn",
        `rf-btn--${variant}`,
        iconOnly && "rf-btn--icon-only",
        block && "rf-btn--block",
        className,
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children !== undefined ? <span className="rf-btn__label">{children}</span> : null}
      {iconEnd ? <Icon name={iconEnd} /> : null}
    </button>
  );
});

/** Typed error thrown when a primitive's contract is violated. */
export class UiPrimitiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UiPrimitiveError";
  }
}
