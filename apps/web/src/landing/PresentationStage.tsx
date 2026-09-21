/**
 * PresentationStage — the landing's walkthrough: a four-step, auto-playing
 * demonstration of the product's path from spreadsheet to report.
 *
 *   1 start    — one readable spreadsheet of monthly activity.
 *   2 check    — a real duplicate row flagged and excluded; blank optional
 *                cells stay visible; the preparation summary updates.
 *   3 build    — the checked data becomes the real report (the golden
 *                ExportModel through SlidePreview) with the chart's purpose
 *                stated beside it.
 *   4 download — the finished report at reading size with a working
 *                English/Arabic toggle and the real download actions.
 *
 * Playback is owned by `PresentationController` (demo/): dwell-based
 * advance, pause on any manual interaction or a hidden/offscreen stage,
 * resume only via Play, and the final step holds — no loop. A pause caused
 * purely by visibility is undone when the stage becomes visible again;
 * a manual pause never is. Under prefers-reduced-motion the same steps
 * render as stable states for manual advance. Focus is never moved on a
 * step change; progress is announced via a polite live region.
 */
import { useEffect, useRef, useState } from "react";
import { Button, VisuallyHidden } from "@rowfolio/ui";
import type { I18n, Locale } from "@rowfolio/i18n";
import type { PresentationController, PresentationState } from "../demo/presentation.ts";
import { landingCopy, type CopyKey } from "./copy.ts";
import { LANDING_TRUTH, type LandingPreviewTruth } from "./previewTruth.ts";
import { SAMPLE_EXPORT_MODEL, findingSlide } from "./sampleExportModel.ts";
import { SlidePreview } from "../briefing/SlidePreview.tsx";
// SlidePreview's component stylesheet is owned by the export dialog — the
// landing must import it directly or the previews render unstyled.
import "../briefing/export.css";

import { setWorkspaceIntent, type IntentDownload } from "./pendingUpload.ts";
import { navigateToWorkspace } from "./routes.ts";
import "./presentation.css";

export const WALKTHROUGH_STEPS = [
  { id: "start", dwellMs: 9000 },
  { id: "check", dwellMs: 10000 },
  { id: "build", dwellMs: 11000 },
  { id: "download", dwellMs: 10000 },
] as const;

export type WalkthroughStepId = (typeof WALKTHROUGH_STEPS)[number]["id"];

const STEP_TITLE: Record<WalkthroughStepId, CopyKey> = {
  start: "walk.step.start.title",
  check: "walk.step.check.title",
  build: "walk.step.build.title",
  download: "walk.step.download.title",
};

const STEP_CAPTION: Record<WalkthroughStepId, CopyKey> = {
  start: "walk.step.start.caption",
  check: "walk.step.check.caption",
  build: "walk.step.build.caption",
  download: "walk.step.download.caption",
};

/**
 * The step survives a language-switch navigation: it rides the hash
 * (`#/pres-ch=N`), which the masthead's sibling-locale link carries over
 * at click time. No storage writes — the privacy canary bans them and the
 * hash router keeps `#/pres-ch` on the landing route. `replaceState`
 * updates without scroll or hashchange noise.
 */
const STEP_HASH = /^#\/pres-ch=(\d+)$/;

export function stepHashFor(index: number): string {
  return `#/pres-ch=${index}`;
}

export function readStoredStep(): number {
  if (typeof window === "undefined") return 0;
  const m = STEP_HASH.exec(window.location.hash);
  if (m === null) return 0;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : 0;
}

function storeStep(index: number): void {
  try {
    window.history.replaceState(null, "", stepHashFor(index));
  } catch {
    /* history may be unavailable — persistence is best-effort */
  }
}

export interface PresentationStageProps {
  readonly i18n: I18n;
  /** The shared controller — the hero's Watch/Replay action drives the
      same instance, so LandingApp creates it and subscribes for labels. */
  readonly controller: PresentationController;
}

export function PresentationStage({ i18n, controller }: PresentationStageProps) {
  const truth = LANDING_TRUTH;
  const [state, setState] = useState<PresentationState>(controller.getState());
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => controller.subscribe(setState), [controller]);

  // Preserve the step across the language-switch navigation.
  useEffect(() => storeStep(state.chapterIndex), [state.chapterIndex]);

  // Any manual interaction outside the transport pauses playback; a hidden
  // tab or a stage scrolled out of view pauses too. Resume is ALWAYS an
  // explicit Play — a paused deck never restarts on its own. Keyboard
  // transport mirrors the icons (mirrored in RTL): ← back / → next /
  // Space toggle / Esc pause. Keys are ignored while focus sits on an
  // interactive element.
  useEffect(() => {
    const inControls = (t: EventTarget | null) =>
      t instanceof Element && t.closest("[data-presentation-controls]") !== null;
    const onPointer = (e: Event) => {
      if (!inControls(e.target)) controller.notifyInteraction();
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      const interactive =
        t instanceof Element &&
        t.closest("button, a, input, select, textarea, [contenteditable='true']") !== null;
      if (interactive) {
        if (!inControls(t)) controller.notifyInteraction();
        return;
      }
      const rtl = i18n.locale === "ar";
      if (e.key === "ArrowRight") {
        e.preventDefault();
        controller.pause();
        if (rtl) controller.back();
        else controller.next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        controller.pause();
        if (rtl) controller.next();
        else controller.back();
      } else if (e.key === " ") {
        e.preventDefault();
        if (controller.getState().status === "playing") controller.pause();
        else controller.resume();
      } else if (e.key === "Escape") {
        controller.pause();
      }
    };
    const onVisibility = () => controller.notifyVisibility(!document.hidden);
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      if (!entry.isIntersecting) controller.pause();
    });
    if (stageRef.current !== null) observer.observe(stageRef.current);
    // Hash history is real navigation: Back/Forward across `#/pres-ch=N`
    // entries and direct `#/pres-ch=N` URLs must move the deck to match,
    // or the displayed step desyncs from the URL. `hashchange` covers
    // in-document hash moves; `popstate` covers history traversal.
    const onHashNav = () => {
      const index = readStoredStep();
      if (index !== controller.getState().chapterIndex) {
        controller.pause();
        controller.goToChapter(index);
      }
    };
    window.addEventListener("hashchange", onHashNav);
    window.addEventListener("popstate", onHashNav);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", onHashNav);
      window.removeEventListener("popstate", onHashNav);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [controller, i18n.locale]);

  const step = WALKTHROUGH_STEPS[state.chapterIndex] ?? WALKTHROUGH_STEPS[0];
  const playing = state.status === "playing";
  const held = state.status === "held";

  const openWorkspace = () => {
    setWorkspaceIntent({ kind: "sample" });
    navigateToWorkspace();
  };
  const download = (format: IntentDownload) => {
    setWorkspaceIntent({ kind: "sample", download: format });
    navigateToWorkspace();
  };
  // Manual navigation is itself a pause: auto-advance resumes only via an
  // explicit Play, per the playback contract.
  const goBack = () => {
    controller.pause();
    controller.back();
  };
  const goForward = () => {
    controller.pause();
    controller.next();
  };
  const goStep = (i: number) => {
    controller.pause();
    controller.goToChapter(i);
  };

  return (
    <div
      className="rf-walk"
      ref={stageRef}
      data-testid="presentation-stage"
      data-status={state.status}
      data-step={step.id}
    >
      {/* One stable explanation area — the caption never scrolls away. */}
      <div className="rf-walk__explain">
        <h2 className="rf-walk__step" id="rf-walk-title">
          <span
            className="rf-walk__stepnum rf-numeric"
            dir="ltr"
            data-testid="presentation-step"
          >
            {state.chapterIndex + 1} / {WALKTHROUGH_STEPS.length}
          </span>
          {landingCopy(i18n.locale, STEP_TITLE[step.id])}
        </h2>
        <p className="rf-walk__caption">{landingCopy(i18n.locale, STEP_CAPTION[step.id])}</p>
      </div>

      <div className="rf-walk__visual" key={step.id}>
        {step.id === "start" && <StartVisual truth={truth} i18n={i18n} />}
        {step.id === "check" && <CheckVisual truth={truth} i18n={i18n} />}
        {step.id === "build" && <BuildVisual i18n={i18n} />}
        {step.id === "download" && <DownloadVisual i18n={i18n} />}
      </div>

      {(step.id === "download" || held) && (
        <div className="rf-walk__end">
          <Button
            variant="primary"
            icon="download"
            onClick={() => download("pptx")}
            data-testid="presentation-download-pptx"
          >
            {landingCopy(i18n.locale, "pres.downloadPptx")}
          </Button>
          <Button
            variant="secondary"
            icon="download"
            onClick={() => download("xlsx")}
            data-testid="presentation-download-xlsx"
          >
            {landingCopy(i18n.locale, "pres.downloadXlsx")}
          </Button>
          <Button
            variant="secondary"
            iconEnd="arrow-end"
            onClick={openWorkspace}
            data-testid="presentation-explore"
          >
            {landingCopy(i18n.locale, "pres.explore")}
          </Button>
        </div>
      )}

      <div className="rf-walk__controls" data-presentation-controls="">
        <div className="rf-walk__transport">
          <button
            type="button"
            className="rf-walk__tbtn"
            onClick={goBack}
            disabled={state.chapterIndex <= 0}
            data-testid="presentation-prev"
          >
            <svg className="rf-icon rf-icon--mirror" viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 5-7 7 7 7" />
            </svg>
            {landingCopy(i18n.locale, "pres.previous")}
          </button>
          {playing ? (
            <button
              type="button"
              className="rf-walk__tbtn rf-walk__tbtn--primary"
              onClick={() => controller.pause()}
              data-testid="presentation-pause"
            >
              <svg className="rf-icon" viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="9" y1="6" x2="9" y2="18" />
                <line x1="15" y1="6" x2="15" y2="18" />
              </svg>
              {landingCopy(i18n.locale, "pres.pause")}
            </button>
          ) : (
            <button
              type="button"
              className="rf-walk__tbtn rf-walk__tbtn--primary"
              onClick={() => controller.resume()}
              data-testid="presentation-play"
            >
              <svg className="rf-icon rf-icon--mirror" viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m8 5 11 7-11 7Z" />
              </svg>
              {landingCopy(i18n.locale, "pres.play")}
            </button>
          )}
          <button
            type="button"
            className="rf-walk__tbtn"
            onClick={goForward}
            disabled={held}
            data-testid="presentation-next"
          >
            <svg className="rf-icon rf-icon--mirror" viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 5 7 7-7 7" />
            </svg>
            {landingCopy(i18n.locale, "pres.next")}
          </button>
        </div>

        <ol
          className="rf-walk__steps"
          aria-label={landingCopy(i18n.locale, "pres.progress", {
            n: state.chapterIndex + 1,
            total: WALKTHROUGH_STEPS.length,
          })}
        >
          {WALKTHROUGH_STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className="rf-walk__tab"
                data-active={i === state.chapterIndex || undefined}
                data-done={i < state.chapterIndex || held || undefined}
                aria-current={i === state.chapterIndex ? "step" : undefined}
                onClick={() => goStep(i)}
                data-testid={`presentation-step-${s.id}`}
              >
                {landingCopy(i18n.locale, STEP_TITLE[s.id])}
              </button>
            </li>
          ))}
        </ol>

        <button
          type="button"
          className="rf-walk__replay"
          onClick={() => controller.replay()}
          data-testid="presentation-replay"
        >
          {landingCopy(i18n.locale, "pres.replay")}
        </button>
      </div>

      <div role="status" aria-live="polite">
        <VisuallyHidden>
          {landingCopy(i18n.locale, "pres.progress", {
            n: state.chapterIndex + 1,
            total: WALKTHROUGH_STEPS.length,
          })}
          {" — "}
          {landingCopy(i18n.locale, STEP_TITLE[step.id])}
        </VisuallyHidden>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step visuals — real cells, real labels, real figures.               */

/** Step 1 — one readable spreadsheet of monthly activity. Friendly
    column headings over verbatim fixture values; no raw IDs introduce
    the file. */
function StartVisual({ truth, i18n }: { truth: LandingPreviewTruth; i18n: I18n }) {
  const L = i18n.locale;
  return (
    <figure className="rf-walk__paper rf-walk-sheet">
      <figcaption className="rf-walk-sheet__file">
        <bdi className="rf-mono">{truth.dataset.fileName}</bdi>
        <span className="rf-walk-sheet__note">{landingCopy(L, "walk.sheet.monthly")}</span>
      </figcaption>
      <table className="rf-walk-sheet__table">
        <thead>
          <tr>
            <th>{landingCopy(L, "walk.col.date")}</th>
            <th>{landingCopy(L, "walk.col.region")}</th>
            <th className="rf-numeric">{landingCopy(L, "walk.col.revenue")}</th>
            <th className="rf-numeric">{landingCopy(L, "walk.col.plan")}</th>
          </tr>
        </thead>
        <tbody>
          {truth.excerpt.map((cells, i) => (
            <tr key={i}>
              <td>{i18n.formatDate(cells[1]!, { dateStyle: "medium" })}</td>
              <td>{cells[2]}</td>
              <td className="rf-numeric">{i18n.formatNumber(cells[4]!, { maxFractionDigits: 0 })}</td>
              <td className="rf-numeric">{i18n.formatNumber(cells[5]!, { maxFractionDigits: 0 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Step 2 — one real duplicate pair (the second copy is excluded) and a
    blank optional cell that stays visible, beside the preparation summary. */
function CheckVisual({ truth, i18n }: { truth: LandingPreviewTruth; i18n: I18n }) {
  const L = i18n.locale;
  const dup = truth.checkDupPair;
  const missing = truth.checkMissingRow;
  return (
    <figure className="rf-walk__paper rf-walk-sheet rf-walk-sheet--check">
      <table className="rf-walk-sheet__table">
        <thead>
          <tr>
            <th>{landingCopy(L, "walk.col.region")}</th>
            <th className="rf-numeric">{landingCopy(L, "walk.col.revenue")}</th>
            <th className="rf-numeric">{landingCopy(L, "walk.col.plan")}</th>
            <th className="rf-numeric">{landingCopy(L, "walk.col.survey")}</th>
          </tr>
        </thead>
        <tbody>
          {truth.checkExcerpt.map((cells, i) => {
            const excluded = i === dup[1];
            const blank = i === missing;
            return (
              <tr key={i} data-excluded={excluded || undefined}>
                <td>
                  {cells[1]}
                  {excluded && (
                    <span className="rf-walk-tag rf-walk-tag--excluded">{landingCopy(L, "walk.tag.excluded")}</span>
                  )}
                </td>
                <td className="rf-numeric">{i18n.formatNumber(cells[2]!, { maxFractionDigits: 0 })}</td>
                <td className="rf-numeric">{i18n.formatNumber(cells[3]!, { maxFractionDigits: 0 })}</td>
                <td className="rf-numeric" data-blank={blank || undefined}>
                  {blank ? (
                    <span className="rf-walk-tag rf-walk-tag--blank">{landingCopy(L, "walk.tag.blank")}</span>
                  ) : (
                    i18n.formatInteger(cells[4]!)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <figcaption className="rf-walk-check__summary">
        <span className="rf-walk-check__count">
          <span className="rf-numeric">{i18n.formatInteger(truth.dataset.rawRecords)}</span>
          <span className="rf-walk-check__arrow" aria-hidden="true">→</span>
          <span className="rf-numeric">{i18n.formatInteger(truth.dataset.cleanRecords)}</span>
        </span>
        <span>{landingCopy(L, "walk.check.dupNote", { n: i18n.formatInteger(truth.dataset.duplicateRows) })}</span>
        <span>{landingCopy(L, "walk.check.blankNote", { n: i18n.formatInteger(truth.dataset.missingOptionalCells) })}</span>
      </figcaption>
    </figure>
  );
}

/** Step 3 — the checked data becomes the real report: the golden
    ExportModel through the same SlidePreview the export dialog renders,
    with the chart's purpose stated beside it. */
function BuildVisual({ i18n }: { i18n: I18n }) {
  const model = SAMPLE_EXPORT_MODEL[i18n.locale];
  return (
    <figure className="rf-walk__paper rf-walk-build">
      <div className="rf-walk-build__slide">
        <SlidePreview model={model} slide={findingSlide(model)} />
      </div>
      <figcaption className="rf-walk-build__note">
        {landingCopy(i18n.locale, "walk.build.chartNote")}
      </figcaption>
    </figure>
  );
}

/** Step 4 — the finished report at reading size; a working English/Arabic
    toggle swaps the real ExportModel in place. */
function DownloadVisual({ i18n }: { i18n: I18n }) {
  const [viewLocale, setViewLocale] = useState<Locale>(i18n.locale);
  const model = SAMPLE_EXPORT_MODEL[viewLocale];
  const locales: readonly Locale[] = ["en", "ar"];
  return (
    <figure className="rf-walk__paper rf-walk-get">
      <div className="rf-walk-get__toggle" role="group" aria-label={landingCopy(i18n.locale, "walk.get.langLabel")}>
        {locales.map((loc) => (
          <button
            key={loc}
            type="button"
            className="rf-walk-get__lang"
            data-active={viewLocale === loc || undefined}
            aria-pressed={viewLocale === loc}
            onClick={() => setViewLocale(loc)}
            lang={loc}
          >
            {i18n.localeName(loc)}
          </button>
        ))}
      </div>
      <div className="rf-walk-get__slide" dir={viewLocale === "ar" ? "rtl" : "ltr"} key={viewLocale}>
        <SlidePreview model={model} slide={findingSlide(model)} />
      </div>
    </figure>
  );
}
