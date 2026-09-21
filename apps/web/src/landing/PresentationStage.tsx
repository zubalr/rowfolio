/**
 * PresentationStage — the landing's dominant first-screen element: an
 * automatic, controllable presentation of the product's core transform.
 *
 * Composition per A21's spec: one fixed 16:9 cobalt window on ivory
 * margins where three artifacts persist and morph between positions —
 * never teleport. The checkpoint mounts three chapters: the triad at rest
 * (spreadsheet left-back, chart mid, report right-front), the signature
 * "mark travels" transition (selected cells pulse → bars grow → the
 * vermilion delta bracket assembles → the report lifts forward), and the
 * held finished report beside credit, downloads and the workspace entry.
 *
 * Playback is owned by `PresentationController` (demo/): it starts on
 * mount, dwells per chapter, pauses on any manual interaction, hidden tab
 * or keypress, resumes only via Play, and holds the report at the end —
 * no loop. Under prefers-reduced-motion the same chapters render as stable
 * scenes for manual advance. Focus is never moved on scene change;
 * chapter changes are announced via a polite live region.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button, Icon, VisuallyHidden } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import {
  PresentationController,
  type PresentationChapterDef,
  type PresentationState,
} from "../demo/presentation.ts";
import { landingCopy, type CopyKey } from "./copy.ts";
import { LANDING_TRUTH, type LandingPreviewTruth } from "./previewTruth.ts";
import { prefersReducedMotion } from "./useReducedMotion.ts";
import { setWorkspaceIntent } from "./pendingUpload.ts";
import { navigateToWorkspace } from "./routes.ts";
import "./presentation.css";

const CHAPTERS: readonly PresentationChapterDef[] = [
  { id: "result", dwellMs: 7000 },
  { id: "transform", dwellMs: 9000 },
  { id: "report", dwellMs: 9000 },
];

const CHAPTER_LABEL: Record<string, CopyKey> = {
  result: "pres.chapter.result",
  transform: "pres.chapter.transform",
  report: "pres.chapter.report",
};

const CHAPTER_CAPTION: Record<string, CopyKey> = {
  result: "pres.scene.result.caption",
  transform: "pres.scene.transform.caption",
  report: "pres.scene.report.caption",
};

/**
 * The chapter survives a language-switch navigation: it rides the hash
 * (`#/pres-ch=N`), which the masthead's sibling-locale link carries over
 * at click time. No storage writes — the privacy canary bans them and the
 * hash router keeps `#/pres-ch` on the landing route. `replaceState`
 * updates without scroll or hashchange noise.
 */
const CHAPTER_HASH = /^#\/pres-ch=(\d+)$/;

function chapterHashFor(index: number): string {
  return `#/pres-ch=${index}`;
}

function readStoredChapter(): number {
  if (typeof window === "undefined") return 0;
  const m = CHAPTER_HASH.exec(window.location.hash);
  if (m === null) return 0;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : 0;
}

function storeChapter(index: number): void {
  try {
    window.history.replaceState(null, "", chapterHashFor(index));
  } catch {
    /* history may be unavailable — persistence is best-effort */
  }
}

export interface PresentationStageProps {
  readonly i18n: I18n;
}

export function PresentationStage({ i18n }: PresentationStageProps) {
  const truth = LANDING_TRUTH;
  const controller = useMemo(
    () =>
      new PresentationController({
        chapters: CHAPTERS,
        prefersReducedMotion,
        initialIndex: readStoredChapter(),
      }),
    [],
  );
  const [state, setState] = useState<PresentationState>(controller.getState());

  useEffect(() => controller.subscribe(setState), [controller]);

  // Auto-start once the first scene is mounted; tear down on unmount.
  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);

  // Preserve the chapter across the language-switch navigation.
  useEffect(() => storeChapter(state.chapterIndex), [state.chapterIndex]);

  // Any manual interaction outside the transport pauses playback; a hidden
  // tab pauses and never auto-resumes. Keyboard transport mirrors the
  // stage icons (mirrored in RTL): ← back / → next / Space toggle / Esc
  // pause. Keys are ignored while focus sits on an interactive element so
  // native button semantics (Space = activate) keep working.
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
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [controller, i18n.locale]);

  const chapter = CHAPTERS[state.chapterIndex] ?? CHAPTERS[0]!;
  const chapterLabel = landingCopy(i18n.locale, CHAPTER_LABEL[chapter.id] ?? "pres.chapter.result");
  const captionKey = CHAPTER_CAPTION[chapter.id] ?? "pres.scene.result.caption";

  const openWorkspace = () => {
    setWorkspaceIntent({ kind: "sample" });
    navigateToWorkspace();
  };
  const download = () => {
    // Native files are produced in the workspace export dialog; the intent
    // lands the sample session there, one click from "Prepare briefing".
    setWorkspaceIntent({ kind: "sample" });
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
  const goChapter = (i: number) => {
    controller.pause();
    controller.goToChapter(i);
  };

  const playing = state.status === "playing";

  return (
    <section
      className="rf-pres"
      aria-labelledby="rf-pres-title"
      data-testid="presentation-stage"
      data-status={state.status}
    >
      <div className="rf-pres__frame" data-chapter={chapter.id}>
        <span className="rf-pres__fiction">
          <Icon name="info" size={16} />
          {landingCopy(i18n.locale, "pres.fictional")}
        </span>
        <div className="rf-pres__stage">
          <figure className="rf-pres-art rf-pres-art--sheet">
            <SceneSheet truth={truth} i18n={i18n} />
            <figcaption className="rf-pres-art__cap">
              {landingCopy(i18n.locale, "pres.artifact.sheet")}
            </figcaption>
          </figure>
          <span className="rf-pres__link" aria-hidden="true" />
          <figure className="rf-pres-art rf-pres-art--chart">
            <SceneChart truth={truth} i18n={i18n} emphasize="North" delta />
            <figcaption className="rf-pres-art__cap">
              {landingCopy(i18n.locale, "pres.artifact.chart")}
            </figcaption>
          </figure>
          <figure className="rf-pres-art rf-pres-art--report">
            <SceneReportCard truth={truth} i18n={i18n} />
            <figcaption className="rf-pres-art__cap">
              {landingCopy(i18n.locale, "pres.artifact.report")}
            </figcaption>
          </figure>
          <div className="rf-pres-end__aside">
            <p className="rf-pres-end__credit">{landingCopy(i18n.locale, "pres.credit")}</p>
            <div className="rf-pres-end__actions">
              <Button
                variant="primary"
                className="rf-pres-cta"
                iconEnd="arrow-end"
                onClick={openWorkspace}
                data-testid="presentation-end-workspace"
              >
                {landingCopy(i18n.locale, "pres.openWorkspace")}
              </Button>
              <Button variant="secondary" icon="download" onClick={download} data-testid="presentation-download-pptx">
                {landingCopy(i18n.locale, "pres.downloadPptx")}
              </Button>
              <Button variant="secondary" icon="download" onClick={download} data-testid="presentation-download-xlsx">
                {landingCopy(i18n.locale, "pres.downloadXlsx")}
              </Button>
              <Button variant="ghost" onClick={() => controller.replay()} data-testid="presentation-replay">
                {landingCopy(i18n.locale, "pres.replay")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Transport — the ink pill pinned at the window's bottom edge. */}
      <div className="rf-pres__controls" data-presentation-controls="">
        <div className="rf-pres__transport">
          <button
            type="button"
            className="rf-pres__tbtn"
            onClick={goBack}
            disabled={state.chapterIndex <= 0}
            data-testid="presentation-prev"
            aria-label={landingCopy(i18n.locale, "pres.previous")}
          >
            <svg className="rf-icon rf-icon--mirror" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 5-7 7 7 7" />
            </svg>
          </button>
          {playing ? (
            <button
              type="button"
              className="rf-pres__tbtn rf-pres__tbtn--primary"
              onClick={() => controller.pause()}
              data-testid="presentation-pause"
              aria-label={landingCopy(i18n.locale, "pres.pause")}
            >
              <svg className="rf-icon" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="9" y1="6" x2="9" y2="18" />
                <line x1="15" y1="6" x2="15" y2="18" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="rf-pres__tbtn rf-pres__tbtn--primary"
              onClick={() => controller.resume()}
              data-testid="presentation-play"
              aria-label={landingCopy(i18n.locale, "pres.play")}
            >
              <svg className="rf-icon rf-icon--mirror" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m8 5 11 7-11 7Z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="rf-pres__tbtn"
            onClick={goForward}
            disabled={state.status === "held"}
            data-testid="presentation-next"
            aria-label={landingCopy(i18n.locale, "pres.next")}
          >
            <svg className="rf-icon rf-icon--mirror" viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 5 7 7-7 7" />
            </svg>
          </button>
        </div>

        <ol className="rf-pres__chapters" aria-label={landingCopy(i18n.locale, "pres.progress", { n: state.chapterIndex + 1, total: CHAPTERS.length })}>
          {CHAPTERS.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className="rf-pres__dot"
                data-active={i === state.chapterIndex || undefined}
                data-done={i < state.chapterIndex || state.status === "held" || undefined}
                aria-current={i === state.chapterIndex ? "step" : undefined}
                onClick={() => goChapter(i)}
                data-testid={`presentation-chapter-${c.id}`}
                aria-label={landingCopy(i18n.locale, CHAPTER_LABEL[c.id] ?? "pres.chapter.result")}
              />
            </li>
          ))}
        </ol>

        <span className="rf-pres__label">
          {chapterLabel}
          <span className="rf-pres__count rf-numeric" dir="ltr" aria-hidden="true">
            {" "}
            {state.chapterIndex + 1}/{CHAPTERS.length}
          </span>
        </span>

        <button
          type="button"
          className="rf-pres__entry"
          onClick={openWorkspace}
          data-testid="presentation-workspace"
        >
          {landingCopy(i18n.locale, "pres.openWorkspace")}
        </button>
      </div>

      <p className="rf-pres__caption">{landingCopy(i18n.locale, captionKey)}</p>

      {/* Subject first — the page headline sits below the window. */}
      <div className="rf-pres__intro">
        <h1 className="rf-pres__title" id="rf-pres-title">
          {landingCopy(i18n.locale, "pres.title")}
        </h1>
        <p className="rf-pres__body">{landingCopy(i18n.locale, "pres.body")}</p>
        <p className="rf-pres__credit">{landingCopy(i18n.locale, "pres.credit")}</p>
      </div>

      <div role="status" aria-live="polite">
        <VisuallyHidden>
          {landingCopy(i18n.locale, "pres.progress", {
            n: state.chapterIndex + 1,
            total: CHAPTERS.length,
          })}
          {" — "}
          {chapterLabel}
        </VisuallyHidden>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Scene building blocks — real cells, real labels, real figures.      */

/** Compact bars of June revenue vs target, one mark per region. */
function SceneChart({
  truth,
  i18n,
  emphasize,
  delta,
}: {
  truth: LandingPreviewTruth;
  i18n: I18n;
  /** Region the story is about — its bar takes the coral emphasis edge. */
  emphasize: string;
  /** Render the vermilion delta bracket over the emphasized bar. */
  delta?: boolean;
}) {
  const W = 220;
  const H = 120;
  const padB = 18;
  const padT = delta ? 26 : 14;
  const max = Math.max(...truth.regionsJune.map((r) => Number(r.targetRevenue)));
  const n = truth.regionsJune.length;
  const slot = W / n;
  const barW = Math.min(22, slot * 0.55);
  return (
    <svg
      className="rf-pres-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={landingCopy(i18n.locale, "landing.chart.title")}
    >
      <line x1={0} y1={H - padB} x2={W} y2={H - padB} className="rf-pres-chart__axis" />
      {truth.regionsJune.map((r, i) => {
        const x = i * slot + (slot - barW) / 2;
        const revH = ((H - padB - padT) * Number(r.revenue)) / max;
        const tgtY = H - padB - ((H - padB - padT) * Number(r.targetRevenue)) / max;
        const hot = r.region === emphasize;
        const barTop = H - padB - revH;
        return (
          <g key={r.region} className="rf-pres-chart__mark" style={{ "--i": i } as CSSProperties}>
            <rect
              className="rf-pres-chart__bar"
              x={x}
              y={barTop}
              width={barW}
              height={revH}
              rx={2}
            />
            <line className="rf-pres-chart__tick" x1={x - 3} y1={tgtY} x2={x + barW + 3} y2={tgtY} />
            <text className="rf-pres-chart__label" x={x + barW / 2} y={H - 6} textAnchor="middle">
              {i18n.t(`region.${r.region}`)}
            </text>
            {hot && delta ? (
              <g className="rf-pres-delta">
                <path
                  className="rf-pres-delta__bracket"
                  d={`M ${x - 4} ${barTop - 5} v -7 h ${barW + 8} v 7`}
                  pathLength={1}
                />
                <line
                  className="rf-pres-delta__span"
                  x1={x - 4}
                  y1={tgtY}
                  x2={x + barW + 4}
                  y2={tgtY}
                />
                <text
                  className="rf-pres-delta__value"
                  x={x + barW / 2}
                  y={barTop - 16}
                  textAnchor="middle"
                >
                  −{i18n.formatPercent(r.targetGapRatio, { minFractionDigits: 1, maxFractionDigits: 1 })}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** The worksheet fragment — verbatim excerpt rows, revenue column marked. */
function SceneSheet({ truth, i18n }: { truth: LandingPreviewTruth; i18n: I18n }) {
  // The fragment shows four columns at reading size — verbatim values,
  // never mid-token ellipsis. Date and site stay in the full workbook.
  const SHOW = ["operation_id", "region", "revenue", "target_revenue"];
  const keep = truth.excerptColumns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => SHOW.includes(c));
  const cols = keep.map(({ c }) => c);
  const revCol = cols.indexOf("revenue");
  return (
    <table className="rf-pres-sheet" dir="ltr">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c} scope="col" className="rf-mono">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {truth.excerpt.slice(0, 5).map((cells, r) => (
          <tr key={cells[0]}>
            {keep.map(({ i: ci }, ciShow) => (
              <td
                key={cols[ciShow]}
                className={ciShow === revCol ? "rf-mono rf-pres-sheet__mark" : "rf-mono"}
                style={{ "--i": r } as CSSProperties}
              >
                {ciShow === revCol ? i18n.formatNumber(cells[ci]!, { minFractionDigits: 2, maxFractionDigits: 2 }) : cells[ci]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Mini report page — a real reading-size composition, not a thumbnail. */
function SceneReportCard({ truth, i18n }: { truth: LandingPreviewTruth; i18n: I18n }) {
  const north = truth.regionsJune.find((r) => r.region === "North");
  const gap = north === undefined ? "0" : north.targetGapRatio;
  return (
    <article className="rf-pres-report">
      <header className="rf-pres-report__head">
        <h3 className="rf-pres-report__title">{landingCopy(i18n.locale, "pres.report.title")}</h3>
        <p className="rf-pres-report__period">{landingCopy(i18n.locale, "pres.report.period")}</p>
      </header>
      <SceneChart truth={truth} i18n={i18n} emphasize="North" delta />
      <p className="rf-pres-report__obs">
        {landingCopy(i18n.locale, "pres.report.observation", {
          gap: i18n.formatPercent(gap, { minFractionDigits: 1, maxFractionDigits: 1 }),
          orders: i18n.formatPercent(truth.northJune.ordersChangeRatio, {
            minFractionDigits: 1,
            maxFractionDigits: 1,
          }),
        })}
      </p>
      <p className="rf-pres-report__proof">
        <Icon name="check" size={16} />
        {landingCopy(i18n.locale, "pres.report.verified", {
          sheet: truth.dataset.sheetName,
          start: i18n.formatInteger(truth.northJune.sourceSpan.start),
          end: i18n.formatInteger(truth.northJune.sourceSpan.end),
        })}
      </p>
    </article>
  );
}
