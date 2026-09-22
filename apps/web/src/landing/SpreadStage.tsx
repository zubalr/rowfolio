/**
 * SpreadStage — the broadsheet spread: one demonstration in the first
 * viewport. A fixed frame runs WORKBOOK → CHECKS → CHART → REPORT as a
 * ~14.4s annotator loop, settles on the finished report for a ≥2.5s hold,
 * then crossfades inside the frame back to a clean workbook restart.
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
import { landingCopy, type CopyKey } from "./copy.ts";
import { LANDING_TRUTH } from "./previewTruth.ts";
import { SAMPLE_EXPORT_MODEL, findingSlide } from "./sampleExportModel.ts";
import { useReducedMotion } from "./useReducedMotion.ts";
import "./spread.css";

/** One loop: workbook 0→3.4s, checks →6.7s, chart →10s, report → restart. */
export const LOOP_MS = 14400;
/** Chapter boundaries within the loop (workbook, checks, chart, report). */
export const CHAPTER_T = [0, 3400, 6700, 10000] as const;
/** Seek targets — each lands inside its chapter's settled window. */
export const CHAPTER_SEEK = [900, 4300, 7700, 11000] as const;
/** The report scene is fully in at REPORT_IN_T; the settled hold runs to
 *  RESTART_T — 3.0s, above the contract's 2.5s minimum. */
export const REPORT_IN_T = 10500;
export const RESTART_T = 13600;
/** Frozen t under prefers-reduced-motion — inside the settled report hold. */
export const HOLD_T = 11000;

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

/** Visible one-sentence caption per chapter (also the live region). */
const CAPTION_KEYS: readonly CopyKey[] = [
  "guide.context.intro",
  "beat.checks",
  "beat.findings",
  "beat.report",
];
/** Named chapter buttons — the transport's seek targets. */
const CHAPTER_KEYS: readonly CopyKey[] = ["ch.workbook", "ch.checks", "ch.chart", "ch.report"];

export interface SpreadStageProps {
  readonly i18n: I18n;
  /** Single primary action — opens the product on the prepared example. */
  readonly onOpen: () => void;
}

export function SpreadStage({ i18n, onOpen }: SpreadStageProps) {
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
      if (event.key === "Escape") clock.pause();
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
  const sheetIn = seg(t, 100, 800);
  const sweep = lin(t, 1100, 2400);
  const vrOn = t >= 1100 && t <= 2800;

  // CHECKS marks dissolve while covered, so the in-frame restart reveals a
  // clean workbook instead of stale strikes.
  const markOut = 1 - lin(t, 12000, 12800);
  const sp = seg(t, 3500, 3900) * markOut;
  const rp = seg(t, 3700, 4100) * markOut;
  const f1 = seg(t, 3900, 4200) * markOut;
  const f2 = seg(t, 4050, 4350) * markOut;
  const checksDone = t >= 4300 && t < 12000;

  // CHART — the observed bar grows to its true share of the target on a
  // shared baseline; the scene crossfades out only as the report lands.
  const chartOp = Math.max(0, lin(t, 6700, 7400) - lin(t, 9900, 10600));
  const shareNorth = Number(truth.northJune.revenue) / Number(truth.northJune.targetRevenue);
  const tgtP = seg(t, 7200, 7700);
  const barP = seg(t, 7700, 8400);
  const tgtValIn = seg(t, 7600, 7900);
  const obsValIn = seg(t, 8300, 8600);
  const deltaShown = -Number(truth.northJune.targetGapRatio) * seg(t, 8500, 9000);
  const deltaP = seg(t, 8700, 8900);
  const ordersShown = Number(truth.northJune.ordersChangeRatio) * seg(t, 9000, 9400);
  // The chip stays invisible until the count has resolved — an early
  // "+0.0%" reads as the wrong sign before the count-up lands.
  const ordersP = seg(t, 9350, 9500);
  const arrowIn = lin(t, 9000, 9450);

  // REPORT — real MiniReport content is mounted from t=0 (never a blank
  // scene); the opaque hold runs REPORT_IN_T → RESTART_T.
  const reportOp = Math.max(0, lin(t, 9900, 10600) - lin(t, 13600, 14400));
  const stamp = seg(t, 10100, 10350);
  const chartIn = seg(t, 10200, 10750);
  const noteIn = seg(t, 10500, 10900);
  const footIn = seg(t, 10700, 11100);
  const wbIn = seg(t, 10800, 11400);

  const rowCountText = checksDone
    ? landingCopy(locale, "data.rows.kept", {
        raw: i18n.formatInteger(truth.dataset.rawRecords),
        kept: i18n.formatInteger(truth.dataset.cleanRecords),
      })
    : landingCopy(locale, "data.rows.read", { n: i18n.formatInteger(truth.dataset.rawRecords) });

  const beatIndex = t < CHAPTER_T[1]! ? 0 : t < CHAPTER_T[2]! ? 1 : t < CHAPTER_T[3]! ? 2 : 3;
  const railFill = CHAPTER_T.map((start, i) =>
    lin(t, start, i === CHAPTER_T.length - 1 ? LOOP_MS : CHAPTER_T[i + 1]!),
  );

  const sheetCovered = chartOp > 0.95 || reportOp > 0.95;
  const chartHidden = chartOp <= 0.02 || reportOp > 0.95;
  const reportHidden = reportOp <= 0.02;

  const seekChapter = (i: number) => {
    if (reduced) {
      setManualT(CHAPTER_SEEK[i]!);
    } else {
      clock.seek(CHAPTER_SEEK[i]!);
    }
    // A chapter tap must reveal the chapter — on phone the frame may be
    // scrolled past, so bring it back into view without hijacking position.
    frameRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const onReplay = () => {
    if (reduced) {
      setManualT(CHAPTER_SEEK[0]!);
    } else {
      clock.replay();
    }
    frameRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const playing = state.status === "playing";

  return (
    <section className="rf-spread" id="how-it-works" aria-labelledby="rf-hero-title">
      <div className="rf-lead">
        <p className="rf-lead__kicker">{landingCopy(locale, "lead.kicker")}</p>
        <h1 className="rf-lead__title" id="rf-hero-title">
          {landingCopy(locale, "lead.title.pre")}
          <em className="rf-lead__accent">{landingCopy(locale, "lead.title.accent")}</em>
          {landingCopy(locale, "lead.title.post")}
        </h1>
        <p className="rf-lead__stand">{landingCopy(locale, "lead.standfirst")}</p>
        <div className="rf-lead__cta">
          <button type="button" className="rf-cta" data-testid="cta-explore" onClick={onOpen}>
            {landingCopy(locale, "lead.cta")}
          </button>
          <span className="rf-lead__ctanote">{landingCopy(locale, "lead.ctaNote")}</span>
        </div>
        <p className="rf-lead__small">{landingCopy(locale, "lead.context")}</p>
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
            clock.toggle();
          }}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              clock.toggle();
            }
          }}
        >
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
                opacity: vrOn ? (t < 2400 ? 1 : 1 - lin(t, 2400, 2800)) : 0,
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
              <p className="rf-wbstrip__title">{model.slides[0]!.title}</p>
              <p className="rf-wbstrip__tabs">{model.sheets.map((s) => s.name).join(" · ")}</p>
              <p className="rf-wbstrip__dl">{landingCopy(locale, "rep.wbFormats")}</p>
            </div>
          </div>
        </div>

        {/* the visible per-chapter caption doubles as the live region */}
        <p className="rf-stage__cap" role="status" aria-live="polite">
          {landingCopy(locale, CAPTION_KEYS[beatIndex]!)}
        </p>

        {/* transport — named chapters, pause/play, replay; ≥44px targets */}
        <div className="rf-transport" role="group" aria-label={landingCopy(locale, "spread.label")}>
          {CHAPTER_KEYS.map((key, i) => (
            <button
              key={key}
              type="button"
              className={`rf-tch${beatIndex === i ? " rf-tch--on" : ""}`}
              aria-current={beatIndex === i ? "true" : undefined}
              onClick={() => seekChapter(i)}
            >
              <span className="rf-tch__num" aria-hidden="true">
                {i18n.formatInteger(0)}
                {i18n.formatInteger(i + 1)}
              </span>
              <span className="rf-tch__name">{landingCopy(locale, key)}</span>
              <i className="rf-tch__fill" aria-hidden="true">
                <i style={{ transform: `scaleX(${railFill[i]!})` }} />
              </i>
            </button>
          ))}
          {!reduced && (
            <button
              type="button"
              className="rf-tplay"
              aria-pressed={playing}
              onClick={(event) => {
                event.stopPropagation();
                clock.toggle();
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
          <button type="button" className="rf-treplay" onClick={onReplay}>
            <svg className="rf-treplay__ic" viewBox="0 0 11 11" aria-hidden="true">
              <path d="M5.5 1a4.5 4.5 0 1 1-4.24 3M1.5 1v3h3" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            {landingCopy(locale, "pres.replay")}
          </button>
        </div>
      </div>
    </section>
  );
}
