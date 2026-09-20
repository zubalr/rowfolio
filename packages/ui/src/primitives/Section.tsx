/**
 * Section — the divider-led grouping primitive.
 *
 * Sections open with a one-pixel rule, an optional cobalt eyebrow, a single
 * heading (default h2) and optional meta/actions — the hierarchy comes from
 * rules and rhythm, not nested cards.
 */
import { useId, type ReactNode } from "react";
import { cx } from "../cx.ts";

export interface SectionProps {
  /** Heading text. */
  title: string;
  /** Small uppercase cobalt kicker above the title. */
  eyebrow?: string;
  /** Right/end-aligned quiet metadata (e.g. row counts, scope note). */
  meta?: ReactNode;
  /** Actions rendered in the header row (buttons, links). */
  actions?: ReactNode;
  /** Heading level — keep document order sensible (default 2). */
  headingLevel?: 2 | 3 | 4;
  /** Accessible-label override; defaults to the title via aria-labelledby. */
  ariaLabel?: string;
  id?: string;
  className?: string;
  children?: ReactNode;
}

export function Section({
  title,
  eyebrow,
  meta,
  actions,
  headingLevel = 2,
  ariaLabel,
  id,
  className,
  children,
}: SectionProps) {
  const autoId = useId();
  const titleId = `${id ?? `rf-section-${autoId}`}-title`;
  const Heading = `h${headingLevel}` as const;
  return (
    <section
      id={id}
      className={cx("rf-section", className)}
      aria-labelledby={ariaLabel ? undefined : titleId}
      aria-label={ariaLabel}
    >
      <div className="rf-section__head">
        <div>
          {eyebrow ? <span className="rf-section__eyebrow">{eyebrow}</span> : null}
          <Heading className="rf-section__title" id={titleId}>
            {title}
          </Heading>
        </div>
        {meta ? <div className="rf-section__meta">{meta}</div> : null}
        {actions ? <div className="rf-section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
