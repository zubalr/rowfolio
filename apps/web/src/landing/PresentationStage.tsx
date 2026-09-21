/**
 * PresentationStage — the landing's dominant first-screen element: an
 * automatic, controllable presentation of the product's core transform.
 *
 * Composition per A21's spec and the brief's seven-beat storyboard: one
 * fixed 16:9 cobalt window on ivory margins where artifacts persist and
 * morph between positions — never teleport.
 *
 *   1 result   — spreadsheet + chart + report share the opening, at rest.
 *   2 task     — the manager's request beside the focused excerpt;
 *                period and measures in plain language.
 *   3 check    — a real duplicate pair flagged in the fragment, the
 *                preparation summary updating 2,417 → 2,400, optional
 *                blank cells shown and explained.
 *   4 change   — the chart develops from the prepared data; direct labels
 *                name unit, period and comparison; the observation is a
 *                single supported sentence.
 *   5 evidence — the result connects to its contributing rows and a
 *                readable calculation, then the story returns to report.
 *   6 prepare  — the report at reading size in both locales, beside the
 *                formatted workbook.
 *   7 deliver  — the finished report holds with Replay, real downloads
 *                and the workspace invitation. No loop.
 *
 * Playback is owned by `PresentationController` (demo/): it starts on
 * mount, dwells per chapter, pauses on any manual interaction, hidden tab
 * or keypress, resumes only via Play, and holds the deliver scene at the
 * end. Under prefers-reduced-motion the same chapters render as stable
 * scenes for manual advance. Focus is never moved on scene change;
 * chapter changes are announced via a polite live region.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button, Icon, VisuallyHidden } from "@rowfolio/ui";
import { createI18n } from "@rowfolio/i18n";
import type { I18n, Locale } from "@rowfolio/i18n";
import {
  PresentationController,
  type PresentationChapterDef,
  type PresentationState,
} from "../demo/presentation.ts";
import { landingCopy, type CopyKey } from "./copy.ts";
import { LANDING_TRUTH, type LandingPreviewTruth } from "./previewTruth.ts";
import { prefersReducedMotion } from "./useReducedMotion.ts";
import { setWorkspaceIntent, type IntentDownload } from "./pendingUpload.ts";
import { navigateToWorkspace } from "./routes.ts";
import "./presentation.css";

const CHAPTERS: readonly PresentationChapterDef[] = [
  { id: "result", dwellMs: 7000 },
  { id: "task", dwellMs: 11000 },
  { id: "check", dwellMs: 13000 },
  { id: "change", dwellMs: 13000 },
  { id: "evidence", dwellMs: 13000 },
  { id: "prepare", dwellMs: 14000 },
  { id: "deliver", dwellMs: 11000 },
];

const CHAPTER_LABEL: Record<string, CopyKey> = {
  result: "pres.chapter.result",
  task: "pres.chapter.task",
  check: "pres.chapter.check",
  change: "pres.chapter.change",
  evidence: "pres.chapter.evidence",
  prepare: "pres.chapter.prepare",
  deliver: "pres.chapter.deliver",
};

const CHAPTER_CAPTION: Record<string, CopyKey> = {
  result: "pres.scene.result.caption",
  task: "pres.scene.task.caption",
  check: "pres.scene.check.caption",
  change: "pres.scene.change.caption",
  evidence: "pres.scene.evidence.caption",
  prepare: "pres.scene.prepare.caption",
  deliver: "pres.scene.deliver.caption",
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

  // The other locale's real i18n — scene 6 mirrors the report in place as
  // an actual RTL layout, not a flipped copy. Pure factory, no storage.
  const otherLocale: Locale = i18n.locale === "ar" ? "en" : "ar";
  const otherI18n = useMemo(() => createI18n({ locale: otherLocale }), [otherLocale]);

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
  const caption =
    chapter.id === "change"
      ? landingCopy(i18n.locale, captionKey, {
          gap: i18n.formatPercent(truth.northJune.targetGapRatio, {
            minFractionDigits: 1,
            maxFractionDigits: 1,
          }),
          orders: i18n.formatPercent(truth.northJune.ordersChangeRatio, {
            minFractionDigits: 1,
            maxFractionDigits: 1,
          }),
        })
      : landingCopy(i18n.locale, captionKey);

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
          <figure className="rf-pres-art rf-pres-art--task">
            <TaskCard i18n={i18n} />
          </figure>
          <figure className="rf-pres-art rf-pres-art--sheet">
            <SceneSheet
              truth={truth}
              i18n={i18n}
              checking={chapter.id === "check"}
            />
            <figcaption className="rf-pres-art__cap">
              {landingCopy(i18n.locale, "pres.artifact.sheet")}
            </figcaption>
          </figure>
          <span className="rf-pres__link" aria-hidden="true" />
          <figure className="rf-pres-art rf-pres-art--chart">
            <SceneChart truth={truth} i18n={i18n} delta />
            <figcaption className="rf-pres-art__cap">
              {landingCopy(i18n.locale, "pres.artifact.chart")}
            </figcaption>
          </figure>
          <figure className="rf-pres-art rf-pres-art--check">
            <CheckCard truth={truth} i18n={i18n} />
          </figure>
          <figure className="rf-pres-art rf-pres-art--evidence">
            <EvidenceCard truth={truth} i18n={i18n} />
          </figure>
          <figure className="rf-pres-art rf-pres-art--report">
            <SceneReportCard truth={truth} i18n={i18n} />
            <figcaption className="rf-pres-art__cap">
              {i18n.localeName(i18n.locale)}
            </figcaption>
          </figure>
          <figure className="rf-pres-art rf-pres-art--slideAlt">
            <SceneReportCard truth={truth} i18n={otherI18n} locale={otherLocale} />
            <figcaption className="rf-pres-art__cap">
              {i18n.localeName(otherLocale)}
            </figcaption>
          </figure>
          <figure className="rf-pres-art rf-pres-art--workbook">
            <WorkbookCard truth={truth} i18n={i18n} />
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
              <Button
                variant="secondary"
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

      <p className="rf-pres__caption">{caption}</p>

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

const MONEY_0 = { minFractionDigits: 0, maxFractionDigits: 0 } as const;
const PCT_1 = { minFractionDigits: 1, maxFractionDigits: 1 } as const;

/** The request card — the manager's ask plus the period/measures plain. */
function TaskCard({ i18n }: { i18n: I18n }) {
  const L = i18n.locale;
  return (
    <div className="rf-pres-card rf-pres-task">
      <p className="rf-pres-card__kicker">{landingCopy(L, "pres.task.requestTitle")}</p>
      <p className="rf-pres-task__quote">{landingCopy(L, "pres.task.request")}</p>
      <dl className="rf-pres-task__facts">
        <div className="rf-pres-task__fact">
          <dt>{landingCopy(L, "pres.task.period").split(": ")[0]}</dt>
          <dd>{landingCopy(L, "pres.task.period").split(": ")[1] ?? ""}</dd>
        </div>
        <div className="rf-pres-task__fact">
          <dt>{landingCopy(L, "pres.task.measures").split(": ")[0]}</dt>
          <dd>{landingCopy(L, "pres.task.measures").split(": ")[1] ?? ""}</dd>
        </div>
      </dl>
    </div>
  );
}

/** The preparation summary — counts update on the real manifest. */
function CheckCard({ truth, i18n }: { truth: LandingPreviewTruth; i18n: I18n }) {
  const L = i18n.locale;
  return (
    <div className="rf-pres-card rf-pres-check">
      <p className="rf-pres-card__kicker">{landingCopy(L, "pres.check.title")}</p>
      <p className="rf-pres-check__count">
        <span className="rf-numeric">{i18n.formatInteger(truth.dataset.rawRecords)}</span>
        <span className="rf-pres-check__arrow" aria-hidden="true">→</span>
        <span className="rf-numeric">{i18n.formatInteger(truth.dataset.cleanRecords)}</span>
      </p>
      <ul className="rf-pres-check__list">
        <li>{landingCopy(L, "pres.check.dup", { n: i18n.formatInteger(truth.dataset.duplicateRows) })}</li>
        <li>{landingCopy(L, "pres.check.missing", { n: i18n.formatInteger(truth.dataset.missingOptionalCells) })}</li>
      </ul>
    </div>
  );
}

/** Where the figure comes from — the span and the readable calculation. */
function EvidenceCard({ truth, i18n }: { truth: LandingPreviewTruth; i18n: I18n }) {
  const L = i18n.locale;
  const span = truth.northJune.sourceSpan;
  return (
    <div className="rf-pres-card rf-pres-evidence">
      <p className="rf-pres-card__kicker">{landingCopy(L, "pres.evidence.title")}</p>
      <p className="rf-pres-evidence__span">
        {landingCopy(L, "pres.evidence.span", {
          region: i18n.t("region.North"),
          sheet: span.sheet,
          start: i18n.formatInteger(span.start),
          end: i18n.formatInteger(span.end),
        })}
      </p>
      <p className="rf-pres-evidence__calc rf-mono" dir="ltr">
        ({i18n.formatInteger(truth.northJune.targetRevenue)} − {i18n.formatInteger(truth.northJune.revenue)})
        {" ÷ "}
        {i18n.formatInteger(truth.northJune.targetRevenue)}
        {" = "}
        <strong>−{i18n.formatPercent(truth.northJune.targetGapRatio, PCT_1)}</strong>
      </p>
      <p className="rf-pres-evidence__match">
        <Icon name="check" size={16} />
        {landingCopy(L, "pres.evidence.match")}
      </p>
    </div>
  );
}

/** The formatted workbook — real region figures on a working sheet. */
function WorkbookCard({ truth, i18n }: { truth: LandingPreviewTruth; i18n: I18n }) {
  const L = i18n.locale;
  return (
    <div className="rf-pres-card rf-pres-workbook">
      <p className="rf-pres-card__kicker">{landingCopy(L, "pres.workbook.title")}</p>
      <table className="rf-pres-workbook__table" dir="ltr">
        <thead>
          <tr>
            <th className="rf-mono">region</th>
            <th className="rf-mono">revenue</th>
            <th className="rf-mono">target_revenue</th>
          </tr>
        </thead>
        <tbody>
          {truth.regionsJune.map((r) => (
            <tr key={r.region}>
              <td>{i18n.t(`region.${r.region}`)}</td>
              <td className="rf-numeric">{i18n.formatInteger(r.revenue)}</td>
              <td className="rf-numeric">{i18n.formatInteger(r.targetRevenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rf-pres-workbook__tab rf-mono">{truth.dataset.sheetName}</p>
    </div>
  );
}

/**
 * The worksheet fragment — verbatim excerpt rows. Default mode shows the
 * June North selection with the revenue column marked; check mode swaps
 * in the real checking rows: the OP-00830 pair (second copy flagged
 * excluded) and a row whose optional CSAT cell stays blank.
 */
function SceneSheet({
  truth,
  i18n,
  checking,
}: {
  truth: LandingPreviewTruth;
  i18n: I18n;
  checking: boolean;
}) {
  if (checking) {
    const cols = truth.checkExcerptColumns;
    const revCol = cols.indexOf("revenue");
    const csatCol = cols.indexOf("csat_score");
    const [dupA, dupB] = truth.checkDupPair;
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
          {truth.checkExcerpt.map((cells, r) => {
            const isDupSecond = r === dupB;
            const isDupFirst = r === dupA;
            const isMissing = r === truth.checkMissingRow;
            return (
              <tr
                key={`${cells[0]}-${r}`}
                className={
                  isDupFirst || isDupSecond
                    ? "rf-pres-sheet__row--dup"
                    : undefined
                }
              >
                {cells.map((v, ci) => {
                  const blank = isMissing && ci === csatCol && v === "";
                  return (
                    <td
                      key={cols[ci]}
                      className={[
                        "rf-mono",
                        blank ? "rf-pres-sheet__cell--missing" : "",
                        ci === revCol ? "rf-pres-sheet__mark" : "",
                      ].join(" ").trim()}
                    >
                      {blank ? "—" : ci === revCol ? i18n.formatNumber(v, MONEY_0) : v}
                      {blank ? (
                        <span className="rf-pres-sheet__flag">
                          {landingCopy(i18n.locale, "pres.check.missingTag")}
                        </span>
                      ) : null}
                      {isDupSecond && ci === 0 ? (
                        <span className="rf-pres-sheet__flag rf-pres-sheet__flag--drop">
                          {landingCopy(i18n.locale, "pres.check.dupTag")}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  // The default fragment — four columns at reading size, verbatim values.
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

/** Compact bars of June revenue vs target, one mark per region. */
function SceneChart({
  truth,
  i18n,
  delta,
}: {
  truth: LandingPreviewTruth;
  i18n: I18n;
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
    <div className="rf-pres-chart">
      <p className="rf-pres-chart__head">{landingCopy(i18n.locale, "landing.chart.title")}</p>
      <svg
        className="rf-pres-chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={landingCopy(i18n.locale, "landing.chart.title")}
      >
        <line x1={0} y1={H - padB} x2={W} y2={H - padB} className="rf-pres-chart__axis" />
        {truth.regionsJune.map((r, i) => {
          const x = i * slot + (slot - barW) / 2;
          const revH = ((H - padB - padT) * Number(r.revenue)) / max;
          const tgtY = H - padB - ((H - padB - padT) * Number(r.targetRevenue)) / max;
          const hot = r.region === "North";
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
                    −{i18n.formatPercent(r.targetGapRatio, PCT_1)}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The report page — a real reading-size composition, teal spine. */
function SceneReportCard({
  truth,
  i18n,
  locale,
}: {
  truth: LandingPreviewTruth;
  i18n: I18n;
  /** Copy locale for this card — defaults to the card's own i18n locale. */
  locale?: Locale;
}) {
  const L = locale ?? i18n.locale;
  const north = truth.regionsJune.find((r) => r.region === "North");
  const gap = north === undefined ? "0" : north.targetGapRatio;
  return (
    <article className="rf-pres-report" dir={L === "ar" ? "rtl" : "ltr"} lang={L}>
      <header className="rf-pres-report__head">
        <h3 className="rf-pres-report__title">{landingCopy(L, "pres.report.title")}</h3>
        <p className="rf-pres-report__period">{landingCopy(L, "pres.report.period")}</p>
      </header>
      <SceneChart truth={truth} i18n={i18n} delta />
      <p className="rf-pres-report__obs">
        {landingCopy(L, "pres.report.observation", {
          gap: i18n.formatPercent(gap, PCT_1),
          orders: i18n.formatPercent(truth.northJune.ordersChangeRatio, PCT_1),
        })}
      </p>
      <p className="rf-pres-report__proof">
        <Icon name="check" size={16} />
        {landingCopy(L, "pres.report.verified", {
          sheet: truth.dataset.sheetName,
          start: i18n.formatInteger(truth.northJune.sourceSpan.start),
          end: i18n.formatInteger(truth.northJune.sourceSpan.end),
        })}
      </p>
    </article>
  );
}
