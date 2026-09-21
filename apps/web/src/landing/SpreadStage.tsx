/**
 * SpreadStage — the broadsheet spread: three numbered plates (01 DATA,
 * 02 FINDINGS, 03 REPORT) that animate through one ~12s annotator loop,
 * then hold the finished spread.
 *
 * Real content only: the table rows are verbatim `sample_operations.csv`
 * physical rows (`LANDING_TRUTH.excerpt` plus the fixture's real duplicate
 * record OP-00830 and the real blank-survey row OP-00039); every figure is
 * derived from `LANDING_TRUTH`; the report plate renders the real
 * `MiniReport` — the finding slide recomposed at plate scale — renders the
 * export model's real strings and figures at readable sizes.
 *
 * Motion: LoopClock (demo/loopClock.ts) drives `t`; this component maps
 * t → styles. Click/Space/tap toggles pause, rail ticks seek, Replay
 * restarts, a hidden tab or offscreen stage auto-pauses, and
 * prefers-reduced-motion renders the finished spread statically.
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

const LOOP_MS = 12000;
/** Beat start offsets driving the rail ticks. */
const BEAT_T = [900, 3300, 6300] as const;
/** Frozen frame used under prefers-reduced-motion (inside the final hold). */
const HOLD_T = 9300;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const eo = (p: number): number => 1 - Math.pow(1 - p, 3);
const seg = (t: number, a: number, b: number): number => eo(clamp01((t - a) / (b - a)));
const lin = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

interface PlateRect {
  dupTop: number;
  dupH: number;
  blankLeft: number;
  blankTop: number;
  blankW: number;
  blankH: number;
  bodyW: number;
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
}

/**
 * The spread's table: verbatim `sample_operations.csv` rows — the June
 * North excerpt, the real duplicate record (second physical copy of
 * OP-00830, the same-op-number row the checker excludes) and the real row
 * whose optional csat_score cell is blank (OP-00039).
 */
/** Real csat_score values for the excerpt rows (physical column 11). */
const EXCERPT_CSAT: Record<string, string> = {
  "OP-01801": "85",
  "OP-01802": "90",
  "OP-01803": "83",
  "OP-01804": "86",
  "OP-01805": "90",
  "OP-01806": "91",
};

const DATA_ROWS: readonly RowDef[] = [
  // Three excerpt rows plus the real flagged rows — every row must stay
  // inside the plate's height so the strike/ring annotators land on
  // visible cells.
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
];

/** Other regions' June actual/target share (fixture-derived, not hand-typed). */
const REGION_SHARES: readonly { region: string; share: number }[] = LANDING_TRUTH.regionsJune
  .filter((r) => r.region !== "North")
  .map((r) => ({ region: r.region, share: Number(r.revenue) / Number(r.targetRevenue) }));

const BEAT_KEYS: readonly CopyKey[] = ["guide.context.intro", "beat.findings", "beat.report"];
const RAIL_LABELS: readonly CopyKey[] = ["plate.data", "plate.findings", "plate.report"];

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
  const [meas, setMeas] = useState<PlateRect | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dupRef = useRef<HTMLTableRowElement>(null);
  const blankRef = useRef<HTMLTableCellElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

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
    if (body === null || dup === null || blank === null) return;
    const measure = () => {
      const d = relTo(dup, body);
      const b = relTo(blank, body);
      setMeas({
        dupTop: d.y,
        dupH: dup.offsetHeight,
        blankLeft: b.x,
        blankTop: b.y,
        blankW: blank.offsetWidth,
        blankH: blank.offsetHeight,
        bodyW: body.clientWidth,
      });
    };
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    if (document.fonts?.ready !== undefined) void document.fonts.ready.then(measure);
    return () => window.removeEventListener("resize", onResize);
  }, [i18n.locale]);

  // stage observers: hidden tab + scrolled out of view auto-pause
  useEffect(() => {
    const onVis = () => clock.notifyVisibility(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
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
      io?.disconnect();
    };
  }, [clock]);

  const t = reduced ? HOLD_T : state.t;
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
  const p1 = seg(t, 0, 700);
  const p2 = seg(t, 120, 820);
  const p3 = seg(t, 240, 940);
  const railFill = [seg(t, 400, 900), seg(t, 3500, 3900), seg(t, 6300, 6800)];

  const sweep = lin(t, 1100, 2400);
  const vrOn = t >= 1100 && t <= 2700;
  const sp = seg(t, 2400, 2750);
  const rp = seg(t, 2500, 2850);
  const f1 = seg(t, 2550, 2950);
  const f2 = seg(t, 2650, 3050);

  const barP = seg(t, 3300, 3950);
  const shareNorth = Number(truth.northJune.revenue) / Number(truth.northJune.targetRevenue);
  const barH = shareNorth * 100 * barP;
  const xfade = lin(t, 6200, 7000);
  const deltaShown = -Number(truth.northJune.targetGapRatio) * seg(t, 4000, 4600);
  const ordersShown = Number(truth.northJune.ordersChangeRatio) * seg(t, 4600, 4900);
  // The chip stays invisible until the count has resolved — an early
  // "+0.0%" reads as the wrong sign before the count-up lands.
  const ordersP = seg(t, 4900, 5050);

  const stamp = seg(t, 6400, 6650);
  const chartIn = seg(t, 6450, 7100);
  const noteIn = seg(t, 6800, 7200);
  const footIn = seg(t, 7000, 7400);
  const wbIn = seg(t, 6900, 7500);
  const replayIn = seg(t, 9300, 9800);
  const loopFade = Math.max(lin(t, LOOP_MS - 500, LOOP_MS), 1 - lin(t, 0, 700));

  const rowCountText =
    t >= 2800
      ? landingCopy(locale, "data.rows.kept", {
          raw: i18n.formatInteger(truth.dataset.rawRecords),
          kept: i18n.formatInteger(truth.dataset.cleanRecords),
        })
      : landingCopy(locale, "data.rows.read", { n: i18n.formatInteger(truth.dataset.rawRecords) });

  const beatIndex = t < BEAT_T[1] ? 0 : t < BEAT_T[2] ? 1 : 2;

  const plate = (p: number): CSSProperties => ({
    opacity: p,
    transform: `translateY(${12 * (1 - p)}px)`,
  });



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
        <div className="rf-lead__stat">
          <span className="rf-lead__statnum rf-numeric" dir="ltr">
            {usd(truth.northJune.revenue)}
          </span>
          <span className="rf-lead__statcap">{landingCopy(locale, "lead.statCaption")}</span>
        </div>
        <p className="rf-lead__statinline rf-numeric">
          {landingCopy(locale, "lead.statInline", {
            rev: i18n.formatInteger(Math.round(Number(truth.northJune.revenue))),
            target: i18n.formatInteger(Math.round(Number(truth.northJune.targetRevenue))),
          })}
        </p>
        <div className="rf-lead__cta">
          <button type="button" className="rf-cta" data-testid="cta-explore" onClick={onOpen}>
            {landingCopy(locale, "lead.cta")}
          </button>
          <span className="rf-lead__ctanote">{landingCopy(locale, "lead.ctaNote")}</span>
        </div>
        <p className="rf-lead__small">{landingCopy(locale, "lead.context")}</p>
      </div>

      <div
        ref={stageRef}
        className="rf-plates"
        role="region"
        aria-label={landingCopy(locale, "spread.label")}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if ((event.target as HTMLElement).closest("[data-rail]") !== null) return;
          clock.toggle();
        }}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            clock.toggle();
          } else if (event.key === "Escape") {
            clock.pause();
          }
        }}
      >
        {/* live region — one plain sentence of context per beat */}
        <p className="rf-visually-hidden" role="status" aria-live="polite">
          {landingCopy(locale, BEAT_KEYS[beatIndex]!)}
        </p>

        {/* 01 DATA */}
        <article className="rf-plate rf-plate--data" style={plate(p1)}>
          <header className="rf-plate__label">
            <i aria-hidden="true" />
            <span className="rf-plate__num">01</span>
            {landingCopy(locale, "plate.data")}
          </header>
          <div className="rf-plate__body" ref={bodyRef}>
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
            <table className="rf-grid">
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
                opacity: vrOn ? (t < 2400 ? 1 : 1 - lin(t, 2400, 2700)) : 0,
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
                insetInlineStart: meas === null ? 0 : meas.blankLeft + 4,
                top: meas === null ? 0 : meas.blankTop + 1,
                width: meas === null ? 0 : Math.max(0, meas.blankW - 8),
                height: meas === null ? 0 : Math.max(0, meas.blankH - 2),
              }}
            />
          </div>
        </article>

        {/* 02 FINDINGS */}
        <article
          className="rf-plate rf-plate--find"
          style={{ transform: `translateY(${12 * (1 - p2)}px)`, opacity: p2 * (1 - 0.45 * xfade) }}
        >
          <header className="rf-plate__label">
            <i aria-hidden="true" />
            <span className="rf-plate__num">02</span>
            {landingCopy(locale, "plate.findings")}
          </header>
          <div className="rf-plate__body">
            <div
              className="rf-ghost rf-ghost--find"
              aria-hidden="true"
              style={{ opacity: 0.62 * (1 - seg(t, 3200, 3900)) }}
            >
              <i className="gf-head" />
              <i className="gf-plot">
                <i className="gf-tgt" />
                <i className="gf-bar" />
              </i>
              <i className="gf-ticks" />
              <i className="gf-cap" />
            </div>
            <div className="rf-fchips">
              <span
                className="rf-chip rf-chip--delta rf-numeric"
                dir="ltr"
                style={{ opacity: seg(t, 4030, 4200) }}
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
                      strokeDashoffset: 20 * (1 - lin(t, 4600, 5000)),
                    }}
                  />
                </svg>
                {landingCopy(locale, "find.orders", { change: pct(ordersShown, true) })}
              </span>
            </div>
            <div className="rf-fchart" style={{ transform: `translateY(${-6 * xfade}px)` }}>
              <div className="rf-fchart__plot">
                <div
                  className="rf-ftarget"
                  style={{
                    opacity: seg(t, 3850, 4050),
                    transform: `scaleX(${seg(t, 3850, 4100)})`,
                  }}
                >
                  <span>{usd(truth.northJune.targetRevenue)}</span>
                </div>
                <div className="rf-fbar">
                  <i style={{ height: `${barH}%` }}>
                    <span className="rf-fbar-val" style={{ opacity: seg(t, 3850, 4200) }}>
                      {usd(truth.northJune.revenue)}
                    </span>
                  </i>
                </div>
              </div>
              <div className="rf-rticks" style={{ opacity: seg(t, 4300, 4600) }}>
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
                        opacity: seg(t, 4300 + i * 90, 4500 + i * 90),
                      }}
                    />
                  ))}
                  <b className="rf-rticks__tgt" style={{ opacity: seg(t, 4750, 4950) }} />
                </span>
                <span className="rf-rticks__scale">{landingCopy(locale, "find.scale")}</span>
              </div>
            </div>
            <p className="rf-fcap">{landingCopy(locale, "find.caption", { region: "North" })}</p>
          </div>
        </article>

        {/* 03 REPORT */}
        <article className="rf-plate rf-plate--rep" style={plate(p3)}>
          <header className="rf-plate__label">
            <i aria-hidden="true" />
            <span className="rf-plate__num">03</span>
            {landingCopy(locale, "plate.report")}
          </header>
          <div
            className="rf-plate__body rf-rep"
            style={
              {
                "--stamp": stamp,
                "--chart-in": chartIn,
                "--note-in": noteIn,
                "--foot-in": footIn,
                "--wb-in": wbIn,
              } as CSSProperties
            }
          >
            <div
              className="rf-ghost rf-ghost--rep"
              aria-hidden="true"
              style={{ opacity: 0.62 * (1 - seg(t, 6300, 7050)) }}
            >
              <i className="gr-kick" />
              <i className="gr-title" />
              <i className="gr-plot">
                <i className="gr-tgt" />
                <i className="gr-bar" />
              </i>
              <i className="gr-note" />
              <i className="gr-foot" />
              <i className="gr-wb" />
            </div>
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
        </article>

        {/* loop seam: fades the plate region only — never the page frame */}
        <div className="rf-loopfade" style={{ opacity: loopFade }} aria-hidden="true" />
      </div>

      {/* chapter rail */}
      <div className="rf-rail" data-rail="" role="group" aria-label={landingCopy(locale, "spread.label")}>
        {BEAT_T.map((beatT, i) => (
          <button
            key={beatT}
            type="button"
            className={`rf-rmark${railFill[i]! > 0.02 ? " rf-rmark--on" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              clock.seek(beatT);
            }}
          >
            <i aria-hidden="true" style={{ "--fill": railFill[i]! } as CSSProperties} />
            {landingCopy(locale, RAIL_LABELS[i]!)}
          </button>
        ))}
        <button
          type="button"
          className="rf-replay"
          style={{ opacity: replayIn }}
          onClick={(event) => {
            event.stopPropagation();
            clock.replay();
          }}
        >
          <svg className="rf-replay__ic" viewBox="0 0 11 11" aria-hidden="true">
            <path d="M5.5 1a4.5 4.5 0 1 1-4.24 3M1.5 1v3h3" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          {landingCopy(locale, "pres.replay")}
        </button>
      </div>

    </section>
  );
}
