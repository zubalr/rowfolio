/**
 * GuideBar — compact caption + Back/Next/Pause/Exit controls for the guided
 * demo.
 *
 * The bar never steals focus: step captions are announced through a polite
 * live region, buttons keep their own focus, and Escape exits while
 * preserving results. All labels come from the shared v1.0.0 catalogs —
 * the "next" affordance names the destination step rather than inventing
 * an untranslated string (a dedicated `action.next` key is requested from
 * the i18n owner as a follow-up).
 */
import { useEffect, useState } from "react";
import { Button, VisuallyHidden } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import { landingCopy, type CopyKey } from "../landing/copy.ts";
import type { DemoController, GuideState } from "./controller.ts";
import { GUIDE_STEPS } from "./controller.ts";
import "./guide.css";

export interface GuideBarProps {
  readonly controller: DemoController;
  readonly i18n: I18n;
  /** "Skip — open the workspace": exit the tour into the real product. */
  readonly onOpenWorkspace?: () => void;
  /** Label for the skip control — supplied by the surface that owns the copy. */
  readonly skipLabel?: string;
}

export function GuideBar({ controller, i18n, onOpenWorkspace, skipLabel }: GuideBarProps) {
  const [state, setState] = useState<GuideState>(controller.getState());

  useEffect(() => controller.subscribe(setState), [controller]);

  const { status, stepIndex } = state;
  const step = stepIndex >= 0 ? GUIDE_STEPS[stepIndex] : undefined;

  if (status === "idle") return null;

  const caption = step ? i18n.tSafe(step.captionKey) : "";
  // One plain sentence of context before the step's figures (copy.ts).
  const context = step
    ? landingCopy(i18n.locale, `guide.context.${step.id}` as CopyKey)
    : "";
  const nextStep = stepIndex + 1 < GUIDE_STEPS.length ? GUIDE_STEPS[stepIndex + 1] : undefined;
  const atFirst = stepIndex <= 0;
  const atLast = stepIndex + 1 >= GUIDE_STEPS.length;

  return (
    <div
      className="rf-guide"
      data-testid="guide-bar"
      data-guide-controls=""
      role="group"
      aria-label={i18n.tSafe("nav.demo")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          controller.exit();
        }
      }}
    >
      <header className="rf-guide__label">
        <i aria-hidden="true" />
        <span className="rf-guide__num">
          <bdi dir="ltr" className="rf-numeric">
            {Math.min(stepIndex + 1, GUIDE_STEPS.length)} / {GUIDE_STEPS.length}
          </bdi>
        </span>
        {i18n.tSafe("nav.demo")}
      </header>

      {/* Short step announcement — not every animated frame. */}
      <div role="status" aria-live="polite" className="rf-guide__live">
        <VisuallyHidden>{caption}</VisuallyHidden>
      </div>

      <p className="rf-guide__context">{context}</p>

      <div className="rf-guide__caption" data-testid="guide-caption">
        <span className="rf-guide__text">{caption}</span>
        {state.errorCode !== null ? (
          <span className="rf-guide__error" role="alert">
            {i18n.errorText("TIMEOUT")}
          </span>
        ) : null}
      </div>

      <div className="rf-guide__controls">
        <Button variant="secondary" onClick={() => controller.back()} disabled={atFirst}>
          {i18n.tSafe("action.back")}
        </Button>
        {status === "paused" ? (
          <Button variant="secondary" onClick={() => controller.resume()}>
            {i18n.tSafe("action.resume")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => controller.pause()}>
            {i18n.tSafe("action.pause")}
          </Button>
        )}
        <Button
          variant="secondary"
          iconEnd="arrow-end"
          onClick={() => controller.next()}
          disabled={atLast}
        >
          {nextStep ? i18n.tSafe(nextStep.captionKey) : i18n.tSafe("action.close")}
        </Button>
        <Button variant="secondary" onClick={() => void controller.replay()}>
          {i18n.tSafe("action.replay")}
        </Button>
        {onOpenWorkspace !== undefined ? (
          <Button variant="secondary" onClick={onOpenWorkspace}>
            {skipLabel ?? i18n.tSafe("action.stop")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => controller.exit()}>
            {i18n.tSafe("action.stop")}
          </Button>
        )}
      </div>
    </div>
  );
}
