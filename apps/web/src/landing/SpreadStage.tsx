/**
 * SpreadStage — the broadsheet spread: one demonstration in the first
 * viewport, watch-first. A fixed frame runs RESULT → WORKBOOK → CHECKS →
 * COMPARE → REPORT as a ~30.5s annotator loop: the finished report opens
 * and closes the loop, so the wrap seam lands inside one continuous hold
 * and never blinks. The mechanism is explained after the result is seen.
 *
 * Real content only: the table rows are verbatim `sample_operations.csv`
 * physical rows (`LANDING_TRUTH.excerpt` plus the fixture's real duplicate
 * record OP-00830 and the real blank-survey row OP-00039); every figure is
 * derived from `LANDING_TRUTH`; the report scene renders the real
 * `MiniReport` — the finding slide recomposed for the frame.
 *
 * Transport: named chapter buttons seek the timeline, a pause/play toggle
 * rides beside them, and Replay restarts the loop. Each chapter carries a
 * visible one-sentence caption on a stable line that doubles as the polite
 * live region. A hidden tab or an offscreen stage auto-pauses;
 * prefers-reduced-motion renders the finished report statically and keeps
 * chapter taps working — they swap the frozen frame for manual review.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { I18n } from "@rowfolio/i18n";
import { LoopClock, type LoopClockState } from "../demo/loopClock.ts";
import { MiniReport } from "../demo/MiniReport.tsx";
import { exportFileName } from "../briefing/download.ts";
import { landingCopy, type CopyKey } from "./copy.ts";
import type { IntentDownload } from "./pendingUpload.ts";
import { LANDING_TRUTH } from "./previewTruth.ts";
import { SAMPLE_EXPORT_MODEL, findingSlide } from "./sampleExportModel.ts";
import { useReducedMotion } from "./useReducedMotion.ts";
import "./spread.css";

/** One loop = 27s: result 0→2s, workbook →5s, checks →9s, chart →13.5s,
 *  finding →17s, report + settled hold → restart (contract v3 §5). */
export const LOOP_MS = 27000;
/** Chapter boundaries: result, workbook, checks, chart, finding, report. */
export const CHAPTER_T = [0, 2000, 5000, 9000, 13500, 17000] as const;
/** Seek targets — each lands inside its chapter's settled window. */
export const CHAPTER_SEEK = [1000, 3200, 6600, 11000, 14800, 20000] as const;
/** The report scene is fully landed at REPORT_IN_T; the hold then runs to
 *  the loop wrap — ~8.9s, well above the 3.5s contract minimum. */
export const REPORT_IN_T = 18100;
/** Frozen t under prefers-reduced-motion — inside the settled report hold. */
export const HOLD_T = 21000;

/**
 * Whether an explicit reveal action must scroll. Only the scene's
 * beginning matters: a clipped or fully off-screen frame top means the
 * beat's start is invisible and must be brought back. Anything already
 * revealing its beginning is left alone — autoplay never scrolls, and
 * user chrome never hijacks a position the reader chose.
 */
export function stageNeedsReveal(frameTop: number, viewportHeight: number): boolean {
  return frameTop < 0 || frameTop >= viewportHeight;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const eo = (p: number): number => 1 - Math.pow(1 - p, 3);
const seg = (t: number, a: number, b: number): number => eo(clamp01((t - a) / (b - a)));
const lin = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

interface SceneRect {
  dupTop: number;
  dupH: number;
  blankLeft: number;
  blankTop: number;
  blankW: number;
  blankH: number;
  bodyW: number;
  gridTop: number;
  gridH: number;
}

function relTo(el: HTMLElement, container: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== container) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

interface RowDef {
  readonly op: string;
  readonly dateIso: string;
  readonly region: string;
  readonly revenue: string;
  readonly target: string;
  readonly survey: string;
  readonly dup?: boolean;
  readonly filler?: boolean;
}

/** Real csat_score values for the excerpt rows (physical column 11). */
const EXCERPT_CSAT: Record<string, string> = {
  "OP-01801": "85",
  "OP-01802": "90",
  "OP-01803": "83",
  "OP-01804": "86",
  "OP-01805": "90",
  "OP-01806": "91",
};

/**
 * The workbook scene's table: verbatim `sample_operations.csv` rows — the
 * June North excerpt, the real duplicate record (second physical copy of
 * OP-00830, the same-op-number row the checker excludes) and the real row
 * whose optional csat_score cell is blank (OP-00039).
 */
const DATA_ROWS: readonly RowDef[] = [
  ...LANDING_TRUTH.excerpt.slice(0, 3).map((cells) => ({
    op: cells[0]!,
    dateIso: cells[1]!,
    region: cells[2]!,
    revenue: cells[4]!,
    target: cells[5]!,
    survey: EXCERPT_CSAT[cells[0]!] ?? "",
  })),
  { op: "OP-00830", dateIso: "2026-04-08", region: "East", revenue: "8886.64", target: "9873.09", survey: "82", dup: true },
  { op: "OP-00039", dateIso: "2026-03-11", region: "North", revenue: "8390.41", target: "11999.21", survey: "" },
  // filler rows fill the taller desktop frame; hidden on narrow layouts
  ...LANDING_TRUTH.excerpt.slice(3, 8).map((cells) => ({
    op: cells[0]!,
    dateIso: cells[1]!,
    region: cells[2]!,
    revenue: cells[4]!,
    target: cells[5]!,
    survey: EXCERPT_CSAT[cells[0]!] ?? "",
    filler: true as const,
  })),
];

/** Other regions' June actual/target share (fixture-derived, not hand-typed). */
const REGION_SHARES: readonly { region: string; share: number }[] = LANDING_TRUTH.regionsJune
  .filter((r) => r.region !== "North")
  .map((r) => ({ region: r.region, share: Number(r.revenue) / Number(r.targetRevenue) }));

/** Visible one-sentence caption per beat (also the live region). */
const CAPTION_KEYS: readonly CopyKey[] = [
  "beat.result",
  "guide.context.intro",
  "beat.checks",
  "beat.chart",
  "beat.findings",
  "beat.final",
];
/* The transport names four chapters (director specimen): WORKBOOK, CHECKS,
 * CHART, REPORT. The opening RESULT glimpse replays via the Replay button;
 * the FINDING beat shares the CHART tab — it is the chart's own continuation.
 */
const CHAPTER_KEYS: readonly CopyKey[] = ["ch.workbook", "ch.checks", "ch.chart", "ch.report"];
/** Seek target per tab — into each chapter's settled window. */
const CHAPTER_TAB_SEEK: readonly number[] = [CHAPTER_SEEK[1], CHAPTER_SEEK[2], CHAPTER_SEEK[3], CHAPTER_SEEK[5]];
/** beatIndex → active tab: the result glimpse and the finding beat both
 *  mark the tab that owns their content (REPORT and CHART). */
const BEAT_TO_TAB = [3, 0, 1, 2, 2, 3] as const;

export interface SpreadStageProps {
  readonly i18n: I18n;
  /** Opens the product on the prepared example (the quiet secondary CTA
   *  and the report scene's own action). */
  readonly onOpen: () => void;
  /** The report scene's download action — fires the real export intent. */
  readonly onDownload: (format: IntentDownload) => void;
}

export function SpreadStage({ i18n, onOpen, onDownload }: SpreadStageProps) {
  const reduced = useReducedMotion();
  const clock = useMemo(
    () => new LoopClock({ loopMs: LOOP_MS, prefersReducedMotion: () => reduced }),
    // The media query flips rarely; the clock reads it lazily at each arm.
    [],
  );
  const [state, setState] = useState<LoopClockState>(clock.getState());
  /** Reduced-motion manual review: a chapter tap freezes this t. */
  const [manualT, setManualT] = useState<number | null>(null);
  const [meas, setMeas] = useState<SceneRect | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dupRef = useRef<HTMLTableRowElement>(null);
  const blankRef = useRef<HTMLTableCellElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => clock.subscribe(setState), [clock]);
  useEffect(() => {
    if (!reduced) clock.start();
    return () => clock.dispose();
  }, [clock, reduced]);

  // measure once (and on resize/locale change) for the annotator overlays
  useEffect(() => {
    const body = bodyRef.current;
    const dup = dupRef.current;
    const blank = blankRef.current;
    const grid = gridRef.current;
    if (body === null || dup === null || blank === null || grid === null) return;
    const measure = () => {
      const d = relTo(dup, body);
      const b = relTo(blank, body);
      const g = relTo(grid, body);
      setMeas({
        dupTop: d.y,
        dupH: dup.offsetHeight,
        blankLeft: b.x,
        blankTop: b.y,
        blankW: blank.offsetWidth,
        blankH: blank.offsetHeight,
        bodyW: body.clientWidth,
        gridTop: g.y,
        gridH: grid.offsetHeight,
      });
    };
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    if (document.fonts?.ready !== undefined) void document.fonts.ready.then(measure);
    return () => window.removeEventListener("resize", onResize);
  }, [i18n.locale]);

  // stage observers: hidden tab + scrolled out of view auto-pause;
  // Escape pauses wherever focus sits (the transport buttons hold it
  // after a tap, so a frame-scoped handler would miss it)
  useEffect(() => {
    const onVis = () => clock.notifyVisibility(!document.hidden);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      clock.pause();
      // same no-truncation rule as the pause path — see snapReveal.
      const el = frameRef.current;
      if (el !== null && stageNeedsReveal(el.getBoundingClientRect().top, window.innerHeight)) {
        el.scrollIntoView({ block: "start", behavior: "auto" });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("keydown", onKey);
    const el = stageRef.current;
    let io: IntersectionObserver | null = null;
    if (el !== null && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(([e]) => clock.notifyViewport(e?.isIntersecting ?? true), {
        threshold: 0.15,
      });
      io.observe(el);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("keydown", onKey);
      io?.disconnect();
    };
  }, [clock]);

  const t = reduced ? (manualT ?? HOLD_T) : state.t;
  const locale = i18n.locale;
  const model = SAMPLE_EXPORT_MODEL[locale];
  const slide = findingSlide(model);
  const truth = LANDING_TRUTH;

  const usd = (n: string | number) =>
    landingCopy(locale, "cur.usd", { n: i18n.formatInteger(Math.round(Number(n))) });
  const pct = (ratio: number, sign = false, digits = 1) =>
    // Values that round to a displayed zero must not reach the formatter as
    // a negative — "-0.0" is not a canonical decimal and would throw.
    i18n.formatPercent(Math.abs(ratio) < 0.5 * 10 ** -(digits + 2) ? 0 : ratio, {
      scale: digits,
      signDisplay: sign ? "always" : "auto",
    });

  // ---- timeline ----------------------------------------------------
  // The report is opaque at t=0 (the loop opens on the result) and opaque
  // again through the wrap — the seam hides inside one continuous hold.
  const reportOp = clamp01(1 - lin(t, 1700, 2400) + lin(t, 16400, 17100));
  const sheetIn = seg(t, 1700, 2400);
  const sweep = lin(t, 2700, 4000);
  const vrOn = t >= 2700 && t <= 4400;

  // CHECKS marks dissolve under the incoming chart cover so nothing stale
  // remains when the loop comes back around.
  const markOut = 1 - lin(t, 9000, 9700);
  const sp = seg(t, 5300, 5700) * markOut;
  const rp = seg(t, 5500, 5900) * markOut;
  const f1 = seg(t, 5700, 6000) * markOut;
  const f2 = seg(t, 5900, 6200) * markOut;
  const checksDone = t >= 6300 && t < 9000;

  // CHART (bars draw) then FINDING (sentence + stat assemble) share one
  // scene: the observed bar grows to its true share of the target on a
  // shared baseline, then the deltas and the share scale land on top.
  const chartOp = Math.max(0, lin(t, 8600, 9300) - lin(t, 16400, 17100));
  const shareNorth = Number(truth.northJune.revenue) / Number(truth.northJune.targetRevenue);
  const tgtP = seg(t, 9400, 9900);
  const barP = seg(t, 10000, 10800);
  const tgtValIn = seg(t, 9800, 10200);
  const obsValIn = seg(t, 10600, 11000);
  const deltaShown = -Number(truth.northJune.targetGapRatio) * seg(t, 13700, 14400);
  const deltaP = seg(t, 13800, 14000);
  const ordersShown = Number(truth.northJune.ordersChangeRatio) * seg(t, 14300, 15000);
  // The chip stays invisible until the count has resolved — an early
  // "+0.0%" reads as the wrong sign before the count-up lands.
  const ordersP = seg(t, 15100, 15300);
  const arrowIn = lin(t, 14300, 14900);

  // REPORT — mounted from t=0 so it is never blank; the opening leg is
  // already formed while the return leg plays the land animation and then
  // fades its real actions in for the persistent hold.
  const firstLeg = t < 2400;
  const stamp = firstLeg ? 1 : seg(t, 17000, 17400);
  const chartIn = firstLeg ? 1 : seg(t, 17150, 17700);
  const noteIn = firstLeg ? 1 : seg(t, 17350, 17800);
  const footIn = firstLeg ? 1 : seg(t, 17500, 18000);
  const wbIn = firstLeg ? 1 : seg(t, 17600, 18200);
  const actIn = seg(t, 18000, 18800);

  const rowCountText = checksDone
    ? landingCopy(locale, "data.rows.kept", {
        raw: i18n.formatInteger(truth.dataset.rawRecords),
        kept: i18n.formatInteger(truth.dataset.cleanRecords),
      })
    : landingCopy(locale, "data.rows.read", { n: i18n.formatInteger(truth.dataset.rawRecords) });

  const beatIndex =
    t < CHAPTER_T[1]! ? 0
    : t < CHAPTER_T[2]! ? 1
    : t < CHAPTER_T[3]! ? 2
    : t < CHAPTER_T[4]! ? 3
    : t < CHAPTER_T[5]! ? 4
    : 5;
  const tabIndex = BEAT_TO_TAB[beatIndex]!;
  // One fill per tab across the beats that tab owns: workbook 2-5s, checks
  // 5-9s, chart+finding 9-17s, report 0-2s then 17s to the wrap.
  const railFill = [
    lin(t, 2000, 5000),
    lin(t, 5000, 9000),
    lin(t, 9000, 17000),
    t < 2000 ? lin(t, 0, 2000) : lin(t, 17000, LOOP_MS),
  ];

  const sheetCovered = chartOp > 0.95 || reportOp > 0.95;
  const chartHidden = chartOp <= 0.02 || reportOp > 0.95;
  const reportHidden = reportOp <= 0.02;

  // Every explicit reveal action routes here: chapter tap, Replay, Play
  // after Pause, and the hero's "Watch the walkthrough". block:"start" —
  // never "nearest" — so the scene's beginning always lands visible; a
  // frame already revealing it is left where the reader put it.
  const revealStage = () => {
    const el = frameRef.current;
    if (el === null || !stageNeedsReveal(el.getBoundingClientRect().top, window.innerHeight)) {
      return;
    }
    el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  };

  // A pause (button, frame tap, or Escape) must never truncate a reveal
  // scroll that is still in flight — if the scene's beginning is clipped,
  // the paused frame snaps to it instead of stranding mid-scroll.
  const snapReveal = () => {
    const el = frameRef.current;
    if (el !== null && stageNeedsReveal(el.getBoundingClientRect().top, window.innerHeight)) {
      el.scrollIntoView({ block: "start", behavior: "auto" });
    }
  };

  const seekChapter = (i: number) => {
    if (reduced) {
      setManualT(CHAPTER_TAB_SEEK[i]!);
    } else {
      clock.seek(CHAPTER_TAB_SEEK[i]!);
    }
    revealStage();
  };

  const onReplay = () => {
    if (reduced) {
      setManualT(CHAPTER_SEEK[0]!);
    } else {
      clock.replay();
    }
    revealStage();
  };

  const onToggle = () => {
    const resuming = state.status !== "playing";
    clock.toggle();
    if (resuming) {
      revealStage();
    } else {
      snapReveal();
    }
  };

  const watchDemo = () => {
    // Primary CTA: play the loop from the top and bring the stage to the
    // viewport top — unlike a chapter tap it scrolls even when the frame
    // is partly in view, since its whole job is revealing the demo. Under
    // reduced-motion the clock never runs, so the CTA seeks to the result
    // glimpse — the finished composite — before pinning the stage.
    if (reduced) {
      setManualT(CHAPTER_SEEK[0]!);
    } else {
      clock.replay();
    }
    frameRef.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  };

  const playing = state.status === "playing";

  return (
    <section className="rf-spread" id="how-it-works" aria-labelledby="rf-hero-title">
      <div className="rf-lead">
        <p className="rf-lead__kicker">{landingCopy(locale, "lead.kicker")}</p>
        <h1 className="rf-lead__title" id="rf-hero-title">
          {landingCopy(locale, "lead.title.pre")}
          {/* the accent + its terminal punctuation are one wrapping unit —
              the period never orphans onto its own line */}
          <span className="rf-lead__accline">
            <em className="rf-lead__accent">{landingCopy(locale, "lead.title.accent")}</em>
            {landingCopy(locale, "lead.title.post")}
          </span>
        </h1>
        <p className="rf-lead__stand">{landingCopy(locale, "lead.standfirst")}</p>
        <div className="rf-lead__cta">
          <button type="button" className="rf-cta" data-testid="cta-explore" onClick={watchDemo}>
            {landingCopy(locale, "lead.cta")}
          </button>
          <button type="button" className="rf-cta rf-cta--quiet" data-testid="cta-workspace" onClick={onOpen}>
            {landingCopy(locale, "lead.cta2")}
          </button>
          <span className="rf-lead__ctanote">{landingCopy(locale, "lead.ctaNote")}</span>
        </div>
      </div>

      <div className="rf-stage" ref={stageRef}>
        <div
          ref={frameRef}
          className="rf-stage__frame"
          role="region"
          aria-label={landingCopy(locale, "spread.label")}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            onToggle();
          }}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              onToggle();
            }
          }}
        >
          {/* scenes hold the crossfading beats; the bar below reserves real
              clearance so the transport never overlays the artifact */}
          <div className="rf-stage__scenes">
            {/* WORKBOOK + CHECKS — the sheet is the loop's bottom layer, so
                the restart crossfade lands back on a clean workbook. */}
            <div
              ref={bodyRef}
              className="rf-scene rf-scene--sheet"
            aria-hidden={sheetCovered}
            style={{ opacity: sheetIn, transform: `translateY(${10 * (1 - sheetIn)}px)` }}
          >
            <div className="rf-data__head">
              <span className="rf-filechip">{truth.dataset.fileName}</span>
              <span className="rf-data__sheet">
                {truth.dataset.sheetName} · {landingCopy(locale, "walk.sheet.monthly")}
              </span>
            </div>
            <div className="rf-data__flags">
              <span className="rf-flag" style={{ opacity: f1 }}>
                {landingCopy(locale, "flag.dup")}
              </span>
              <span className="rf-flag" style={{ opacity: f2 }}>
                {landingCopy(locale, "flag.blank")}
              </span>
            </div>
            <table className="rf-grid" ref={gridRef}>
              <thead>
                <tr>
                  <th>{landingCopy(locale, "walk.col.date")}</th>
                  <th>{landingCopy(locale, "walk.col.region")}</th>
                  <th className="rf-num">{landingCopy(locale, "walk.col.revenue")}</th>
                  <th className="rf-num">{landingCopy(locale, "walk.col.plan")}</th>
                  <th className="rf-num rf-col-survey">{landingCopy(locale, "walk.col.survey")}</th>
                </tr>
              </thead>
              <tbody>
                {DATA_ROWS.map((r) => (
                  <tr
                    key={`${r.op}-${r.dateIso}`}
                    ref={r.dup === true ? dupRef : undefined}
                    data-dup={r.dup === true ? "" : undefined}
                    data-filler={r.filler === true ? "" : undefined}
                  >
                    <td>{i18n.formatDate(r.dateIso, { dateStyle: "medium" })}</td>
                    <td>{r.region}</td>
                    <td className="rf-num">{i18n.formatInteger(Math.round(Number(r.revenue)))}</td>
                    <td className="rf-num">{i18n.formatInteger(Math.round(Number(r.target)))}</td>
                    <td
                      className="rf-num rf-col-survey"
                      ref={r.survey === "" ? blankRef : undefined}
                      data-blank={r.survey === "" ? "" : undefined}
                    >
                      {r.survey === "" ? "" : i18n.formatInteger(Number(r.survey))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rf-data__foot">
              <span className="rf-rowcount rf-numeric" dir="ltr">
                {rowCountText}
              </span>
            </div>
            <span
              className="rf-vrule"
              aria-hidden="true"
              style={{
                opacity: vrOn ? (t < 3900 ? 1 : 1 - lin(t, 3900, 4400)) : 0,
                top: meas === null ? 40 : meas.gridTop,
                bottom: "auto",
                height: meas === null ? 0 : meas.gridH,
                insetInlineStart: meas === null ? 14 : 14 + sweep * (meas.bodyW - 28),
              }}
            />
            <span
              className="rf-strike"
              aria-hidden="true"
              style={{
                opacity: sp > 0 ? 1 : 0,
                transform: `scaleX(${sp})`,
                top: meas === null ? 0 : meas.dupTop + meas.dupH / 2,
              }}
            />
            <span
              className="rf-ring"
              aria-hidden="true"
              style={{
                opacity: rp,
                transform: `scale(${lerp(1.2, 1, rp)})`,
                // physical offset — blankLeft is measured in offsetLeft space
                left: meas === null ? 0 : meas.blankLeft + 4,
                top: meas === null ? 0 : meas.blankTop + 1,
                width: meas === null ? 0 : Math.max(0, meas.blankW - 8),
                height: meas === null ? 0 : Math.max(0, meas.blankH - 2),
              }}
            />
          </div>

          {/* CHART — actual vs target on a shared baseline, truthful ratio */}
          <div className="rf-scene rf-scene--chart" aria-hidden={chartHidden} style={{ opacity: chartOp }}>
            <div className="rf-fchips">
              <span
                className="rf-chip rf-chip--delta rf-numeric"
                dir="ltr"
                style={{ opacity: deltaP }}
              >
                {pct(deltaShown, true)}
              </span>
              <span className="rf-chip rf-chip--orders" style={{ opacity: ordersP }}>
                <svg className="rf-chip__arr" viewBox="0 0 9 9" aria-hidden="true">
                  <path
                    d="M1 8 L5 4 L8 1"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    style={{
                      strokeDasharray: 20,
                      strokeDashoffset: 20 * (1 - arrowIn),
                    }}
                  />
                </svg>
                {landingCopy(locale, "find.orders", { change: pct(ordersShown, true) })}
              </span>
            </div>
            <div className="rf-chart__plot" dir="ltr">
              <div className="rf-vpair">
                <span className="rf-vbar-val rf-numeric" style={{ opacity: obsValIn }}>
                  {usd(truth.northJune.revenue)}
                </span>
                <i
                  className="rf-vbar rf-vbar--observed"
                  style={{ height: `${shareNorth * 100 * barP}%` }}
                />
              </div>
              <div className="rf-vpair">
                <span className="rf-vbar-val rf-numeric" style={{ opacity: tgtValIn }}>
                  {usd(truth.northJune.targetRevenue)}
                </span>
                <i className="rf-vbar rf-vbar--target" style={{ height: `${100 * tgtP}%` }} />
              </div>
            </div>
            <div className="rf-vcats" dir="ltr">
              <span>{landingCopy(locale, "find.actualCat")}</span>
              <span>{landingCopy(locale, "find.targetCat")}</span>
            </div>
            <div className="rf-rticks">
              <span className="rf-rticks__label">
                {landingCopy(locale, "find.regions", { n: i18n.formatInteger(4), pct: pct(0.04, false, 0) })}
              </span>
              <span
                className="rf-rticks__track"
                role="img"
                aria-label={landingCopy(locale, "find.scale")}
              >
                <i className="rf-rticks__band" aria-hidden="true" />
                {REGION_SHARES.map((r, i) => (
                  <i
                    key={r.region}
                    className="rf-rticks__tick"
                    style={{
                      insetInlineStart: `${(r.share / 1.1) * 100}%`,
                      opacity: seg(t, 9500 + i * 90, 9700 + i * 90),
                    }}
                  />
                ))}
                <b className="rf-rticks__tgt" style={{ opacity: seg(t, 9750, 9950) }} />
              </span>
              <span className="rf-rticks__scale">{landingCopy(locale, "find.scale")}</span>
            </div>
            <p className="rf-fcap">{landingCopy(locale, "find.caption", { region: "North" })}</p>
          </div>

          {/* REPORT — the real finished slide, readable at frame size */}
          <div
            className="rf-scene rf-scene--rep"
            aria-hidden={reportHidden}
            style={
              {
                opacity: reportOp,
                "--stamp": stamp,
                "--chart-in": chartIn,
                "--note-in": noteIn,
                "--foot-in": footIn,
                "--wb-in": wbIn,
              } as CSSProperties
            }
          >
            <div className="rf-rep__slide">
              <MiniReport model={model} slide={slide} />
            </div>
            <p className="rf-rep__note rf-numeric">
              {landingCopy(locale, "pres.evidence.span", {
                region: "North",
                sheet: truth.northJune.sourceSpan.sheet,
                start: i18n.formatInteger(truth.northJune.sourceSpan.start),
                end: i18n.formatInteger(truth.northJune.sourceSpan.end),
              })}
            </p>
            <div className="rf-wbstrip">
              <div className="rf-wbstrip__meta">
                <p className="rf-wbstrip__title">{model.slides[0]!.title}</p>
                <p className="rf-wbstrip__tabs">{model.sheets.map((s) => s.name).join(" · ")}</p>
                <p className="rf-wbstrip__dl" dir="ltr">
                  {exportFileName(model, "pptx")} · {exportFileName(model, "xlsx")}
                </p>
              </div>
              {/* the persistent report carries its own real actions — they
                  are inert until fully faded in and never steal the frame
                  toggle (stopPropagation at each gesture layer) */}
              <div
                className="rf-rep__actions"
                style={{ opacity: actIn, pointerEvents: actIn > 0.95 ? "auto" : "none" }}
              >
                <button
                  type="button"
                  className="rf-act"
                  tabIndex={actIn > 0.95 ? 0 : -1}
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen();
                  }}
                >
                  {landingCopy(locale, "lead.cta2")}
                </button>
                <button
                  type="button"
                  className="rf-act rf-act--quiet"
                  tabIndex={actIn > 0.95 ? 0 : -1}
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDownload("pptx");
                  }}
                >
                  {landingCopy(locale, "rep.download")}
                </button>
              </div>
            </div>
          </div>
          </div>

          {/* the in-stage bottom bar: the visible per-chapter caption
              (doubling as the live region) above the ONE transport strip —
              named chapters, pause/play, replay, ≥44px targets. Bar clicks
              must not read as a frame tap, so gestures stop here. */}
          <div
            className="rf-stage__bar"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <p className="rf-stage__cap" role="status" aria-live="polite">
              {landingCopy(locale, CAPTION_KEYS[beatIndex]!)}
            </p>
            <div className="rf-transport" role="group" aria-label={landingCopy(locale, "spread.label")}>
              {!reduced && (
                <button
                  type="button"
                  className="rf-tplay"
                  aria-pressed={playing}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle();
                  }}
                >
                  <svg className="rf-tplay__ic" viewBox="0 0 10 10" aria-hidden="true">
                    {playing ? (
                      <path d="M2 1h2.2v8H2zM5.8 1H8v8H5.8z" fill="currentColor" />
                    ) : (
                      <path d="M2.5 1 8.5 5 2.5 9z" fill="currentColor" />
                    )}
                  </svg>
                  {landingCopy(locale, playing ? "pres.pause" : "pres.play")}
                </button>
              )}
              {CHAPTER_KEYS.map((key, i) => (
                <button
                  key={key}
                  type="button"
                  className={`rf-tch${tabIndex === i ? " rf-tch--on" : ""}`}
                  aria-current={tabIndex === i ? "true" : undefined}
                  onClick={() => seekChapter(i)}
                >
                  <span className="rf-tch__name">{landingCopy(locale, key)}</span>
                  <i className="rf-tch__fill" aria-hidden="true">
                    <i style={{ transform: `scaleX(${railFill[i]!})` }} />
                  </i>
                </button>
              ))}
              <button type="button" className="rf-treplay" onClick={onReplay}>
                <svg className="rf-treplay__ic" viewBox="0 0 11 11" aria-hidden="true">
                  <path d="M5.5 1a4.5 4.5 0 1 1-4.24 3M1.5 1v3h3" fill="none" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                {landingCopy(locale, "pres.replay")}
              </button>
            </div>
          </div>
        </div>

        {/* the honest disclosure stays quiet and sits next to the example
            it describes — not inside the hero's action row */}
        <p className="rf-stage__disc">{landingCopy(locale, "lead.context")}</p>
      </div>
    </section>
  );
}
