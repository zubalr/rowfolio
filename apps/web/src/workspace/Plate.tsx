/**
 * Plate primitives for the Broadsheet product surfaces.
 *
 * PlateLabel — the numbered mono micro-label that names a surface's place in
 * the pipeline (`01 UPLOAD`, `02 CHECKS`, `03 FINDINGS`, `04 REPORT`): index,
 * a 24px vermilion rule, then the surface name. Arabic renders the name in
 * the body stack — Plex Mono has no Arabic cut and letter-tracking breaks
 * script shaping (the rule stays on the start side via logical layout).
 *
 * Plate — the one-surface container: white, a 1px rule hairline, panel
 * radius, no shadow. Sections inside flatten to hairline dividers so plates
 * never nest.
 */
import { useId, type ReactNode } from "react";
import { cx } from "@rowfolio/ui";
import { localizeDigits } from "@rowfolio/export-model";
import { useI18n } from "../app/context.tsx";

export function PlateLabel({ index, name }: { index: string; name: string }) {
  const i18n = useI18n();
  return (
    <span className="rf-plate-label">
      <bdi dir="ltr" className="rf-plate-label__num">
        {localizeDigits(index, i18n.numberingSystem)}
      </bdi>
      <span className="rf-plate-label__rule" aria-hidden="true" />
      <span className="rf-plate-label__name">{name}</span>
    </span>
  );
}

export interface PlateProps {
  /** Pipeline index shown in the label, e.g. "01". */
  index: string;
  /** Spine surface name (the mono label text), e.g. i18n.t("plate.upload"). */
  name: string;
  /** Visible heading inside the plate. */
  title: string;
  /** Heading level — keep document order sensible (default 2). */
  headingLevel?: 1 | 2 | 3;
  /** Optional quiet context line under the head ("what am I seeing"). */
  note?: ReactNode;
  className?: string;
  testId?: string;
  children?: ReactNode;
}

export function Plate({
  index,
  name,
  title,
  headingLevel = 2,
  note,
  className,
  testId,
  children,
}: PlateProps) {
  const titleId = useId();
  const Heading = `h${headingLevel}` as const;
  return (
    <section
      className={cx("rf-plate", className)}
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <header className="rf-plate__head">
        <PlateLabel index={index} name={name} />
        <Heading className="rf-plate__title" id={titleId}>
          {title}
        </Heading>
        {note !== undefined && note !== null ? (
          <p className="rf-plate__note">{note}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}
