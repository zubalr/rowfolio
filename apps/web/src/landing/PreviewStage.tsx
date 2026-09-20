/**
 * PreviewStage — the landing's large working specimen: the real product
 * mechanism (source rows → regional comparison → evidence annotation →
 * scenario assumption → briefing contents) rendered with the prepared
 * sample's verified truth from `previewTruth.ts`. It is labeled
 * "Prepared sample" / synthetic and never implies on-demand analysis.
 *
 * The specimen is always fully composed — the authored arrival sequence
 * (row → chart → finding) is a Motion overlay that replays assembly once
 * per `arrivalKey`; under reducedMotion="user" every element settles in
 * its final state immediately.
 *
 * Manual controls (Show me why, the cost-change range, Prepare, Replay)
 * dispatch the same preview actions the DemoController dispatches as a
 * host — the guide is a driver of the real surface, not a fake cursor.
 */
import type { ReactNode } from "react";
import { m } from "motion/react";
import { Button, Bidi, DataTable, Icon } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import { compareDecimal, divideDecimal, subtractDecimal } from "@rowfolio/contracts";
import type { Decimal } from "@rowfolio/contracts";
import { landingCopy } from "./copy.ts";
import type { LandingPreviewTruth } from "./previewTruth.ts";
import type { PreviewAction, PreviewState } from "./previewState.ts";

export interface PreviewStageProps {
  readonly truth: LandingPreviewTruth;
  readonly i18n: I18n;
  readonly state: PreviewState;
  readonly dispatch: (action: PreviewAction) => void;
  /** Increments each time the authored arrival sequence should replay. */
  readonly arrivalKey: number;
  /** Active guide step id, or null — marks the current demo target region. */
  readonly guideStep: string | null;
  /** True while the guide bar should stay mounted (running/paused/complete/error). */
  readonly guideVisible: boolean;
  /** Manual-interaction hook: pauses the guide without exiting it. */
  readonly onManualInteraction: () => void;
  readonly onReplay: () => void;
  /** Route into the real workspace with the prepared sample loaded. */
  readonly onOpenWorkspace: () => void;
  /** Slot rendered inside the stage (guide controls). */
  readonly children?: ReactNode;
}

const PCT = { minFractionDigits: 0, maxFractionDigits: 1, signDisplay: "exceptZero" } as const;
const PCT_UNSIGNED = { minFractionDigits: 0, maxFractionDigits: 1 } as const;
const EASE = [0.2, 0.7, 0.2, 1] as const;

function Target({
  step,
  active,
  children,
  className,
  extra,
}: {
  step: string;
  active: string | null;
  children: ReactNode;
  className?: string;
  extra?: Record<string, string | undefined>;
}) {
  return (
    <div
      data-demo-target={step}
      data-demo-active={active === step ? "" : undefined}
      className={className}
      {...extra}
    >
      {children}
    </div>
  );
}

/** Regional comparison — horizontal actual/target bars, zero baseline. */
function RegionChart({
  truth,
  i18n,
  revealed,
  arrivalKey,
}: {
  readonly truth: LandingPreviewTruth;
  readonly i18n: I18n;
  readonly revealed: boolean;
  readonly arrivalKey: number;
}) {
  const regions = truth.regionsJune;
  const rowH = 30;
  const labelW = 88;
  const gapW = 72;
  const barH = 14;
  const width = 620;
  const barArea = width - labelW - gapW;
  let maxV = 0;
  for (const r of regions) maxV = Math.max(maxV, Number(r.targetRevenue), Number(r.revenue));
  const scale = (v: Decimal) => (Number(v) / maxV) * barArea;
  const height = regions.length * rowH + 30;

  return (
    <figure className="rf-compare" dir="ltr" data-testid="preview-compare">
      <figcaption className="rf-compare__head">
        <span className="rf-compare__title">{landingCopy(i18n.locale, "landing.chart.title")}</span>
        <span className="rf-compare__summary">{landingCopy(i18n.locale, "landing.chart.summary")}</span>
      </figcaption>
      <svg
        className="rf-compare__svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={landingCopy(i18n.locale, "landing.chart.summary")}
      >
        {regions.map((r, i) => {
          const y = i * rowH + 14;
          const actualW = scale(r.revenue);
          const targetX = scale(r.targetRevenue);
          const selected = r.region === "North";
          const gap = compareDecimal(r.revenue, r.targetRevenue) < 0;
          return (
            <g key={r.region}>
              <text
                x={labelW - 10}
                y={y + barH - 2}
                textAnchor="end"
                className={`rf-compare__label${selected ? " rf-compare__label--selected" : ""}`}
              >
                {i18n.t(`region.${r.region}`)}
              </text>
              {/* target tick — ink marker, never a filled bar */}
              <line
                x1={labelW + targetX}
                x2={labelW + targetX}
                y1={y - 3}
                y2={y + barH + 3}
                className="rf-compare__target"
              />
              <m.rect
                key={`bar-${arrivalKey}`}
                x={labelW}
                y={y}
                width={actualW}
                height={barH}
                className={`rf-compare__bar${selected ? " rf-compare__bar--selected" : ""}`}
                initial={{ scaleX: revealed ? 0 : 1 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.6, delay: 0.45 + i * 0.06, ease: EASE }}
                style={{ transformBox: "fill-box", transformOrigin: "left center" }}
              />
              {selected && gap ? (
                <text
                  x={labelW + actualW + 8}
                  y={y + barH - 2}
                  className="rf-compare__gap rf-numeric"
                >
                  −{i18n.formatPercent(r.targetGapRatio, PCT_UNSIGNED)}
                </text>
              ) : null}
            </g>
          );
        })}
        <text x={labelW} y={height - 6} className="rf-compare__axis rf-numeric">
          0
        </text>
        <text x={labelW + barArea} y={height - 6} textAnchor="end" className="rf-compare__axis rf-numeric">
          {i18n.formatInteger(String(maxV))}
        </text>
      </svg>
      <details className="rf-compare__values">
        <summary>{i18n.t("action.viewData")}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{landingCopy(i18n.locale, "common.region")}</th>
              <th scope="col">{i18n.t("common.actual")}</th>
              <th scope="col">{i18n.t("common.target")}</th>
              <th scope="col">{i18n.t("metric.targetGap")}</th>
            </tr>
          </thead>
          <tbody>
            {regions.map((r) => (
              <tr key={r.region}>
                <td dir="auto">{i18n.t(`region.${r.region}`)}</td>
                <td className="rf-numeric">{i18n.formatInteger(r.revenue)}</td>
                <td className="rf-numeric">{i18n.formatInteger(r.targetRevenue)}</td>
                <td className="rf-numeric" dir="ltr">
                  {i18n.formatPercent(r.targetGapRatio, PCT)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function PreviewStage({
  truth,
  i18n,
  state,
  dispatch,
  arrivalKey,
  guideStep,
  guideVisible,
  onManualInteraction,
  onReplay,
  onOpenWorkspace,
  children,
}: PreviewStageProps) {
  const { northJune, june, dataset } = truth;
  const scenario = truth.computeScenario(state.scenarioRatio);
  const baselineMarginPct = i18n.formatPercent(june.baselineMargin, { maxFractionDigits: 0 });
  const scenarioMarginPct =
    scenario.margin === null
      ? i18n.tSafe("common.undefined")
      : i18n.formatPercent(scenario.margin, { maxFractionDigits: 0 });
  const marginDeltaPp =
    scenario.margin === null
      ? null
      : divideDecimal(subtractDecimal(scenario.margin, june.baselineMargin), "0.01");

  // Baseline-vs-assumption paired bars for the scenario chapter — fixed
  // scale across the supported range so deltas read honestly.
  const baselineContribution = Number(june.baselineContribution);
  const scenarioContribution = Number(scenario.contribution);
  const scaleMax = baselineContribution * (1 + Math.abs(Number(truth.scenario.minRatio)));
  const basePct = (baselineContribution / scaleMax) * 100;
  const scenPct = Math.max(0, (scenarioContribution / scaleMax) * 100);

  const hashShort = dataset.sha256.slice(0, 12);

  return (
    <section
      className="rf-stage"
      id="demo"
      aria-labelledby="rf-preview-title"
      data-testid="preview-stage"
    >
      <header className="rf-stage__head">
        <div>
          <h2 id="rf-preview-title" className="rf-stage__title" tabIndex={-1}>
            {i18n.t("workspace.findings")}
          </h2>
          <p className="rf-stage__meta">
            <span className="rf-chip">{i18n.t("common.prepared")}</span>
            <span className="rf-chip rf-chip--quiet">{i18n.t("common.synthetic")}</span>
            <Bidi dir="ltr" className="rf-mono">
              {dataset.fileName}
            </Bidi>
          </p>
        </div>
        <Button variant="secondary" onClick={onReplay}>
          {i18n.t("action.replay")}
        </Button>
      </header>

      {/* The mechanism: source rows → regional comparison → the finding. */}
      <div className="rf-stage__mechanism">
        <m.div
          key={`raw-${arrivalKey}`}
          initial={{ opacity: state.revealed ? 0 : 1, y: state.revealed ? 10 : 0 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0, ease: EASE }}
        >
          <Target
            step="findings"
            active={guideStep}
            className="rf-stage__raw"
            extra={{ "data-evidence-open": state.evidenceOpen ? "" : undefined }}
          >
            <DataTable
              caption={`${i18n.t("common.rows")} — ${i18n.t("common.source")}`}
              scrollLabel={i18n.t("common.rows")}
              columns={[
                // Source headers stay as authored (06_I18N_ARABIC_SPEC.md).
                { id: "operation_id", label: "operation_id", mono: true, dir: "ltr" },
                { id: "date", label: "date", mono: true, dir: "ltr" },
                { id: "region", label: "region", dir: "auto" },
                { id: "site", label: "site", mono: true, dir: "ltr" },
                { id: "revenue", label: "revenue", align: "end", mono: true, dir: "ltr" },
                { id: "target_revenue", label: "target_revenue", align: "end", mono: true, dir: "ltr" },
              ]}
              rows={truth.excerpt.map((cells, i) => ({
                id: String(cells[0]),
                sourceRow: truth.northJune.sourceSpan.start + i,
                values: Object.fromEntries(truth.excerptColumns.map((c, j) => [c, cells[j] ?? ""])),
              }))}
              rangeLabel={() =>
                `${i18n.t("common.source")} ${i18n.formatInteger(
                  truth.northJune.sourceSpan.start,
                )}–${i18n.formatInteger(truth.northJune.sourceSpan.end)} · ${dataset.sheetName}`
              }
              testId="preview-raw"
            />
          </Target>
        </m.div>

        <m.div
          key={`chart-${arrivalKey}`}
          initial={{ opacity: state.revealed ? 0 : 1, y: state.revealed ? 10 : 0 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: EASE }}
          className="rf-stage__chart"
        >
          <RegionChart
            truth={truth}
            i18n={i18n}
            revealed={state.revealed}
            arrivalKey={arrivalKey}
          />
        </m.div>
      </div>

      {/* Evidence chapter — the ink surface opens on demand. */}
      <Target step="evidence" active={guideStep}>
        <m.div
          key={`finding-${arrivalKey}`}
          className="rf-finding-card"
          data-rf-surface="ink"
          data-testid="preview-finding"
          data-revealed={state.revealed ? "" : undefined}
          initial={{ opacity: state.revealed ? 0 : 1, y: state.revealed ? 12 : 0 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.3, ease: EASE }}
        >
          <span className="rf-finding-card__eyebrow">{i18n.t("workspace.findings")}</span>
          <h3 className="rf-finding-card__title">{i18n.t("finding.north.title")}</h3>
          <p className="rf-finding-card__body">
            {i18n.t(
              "finding.north.body",
              {
                gap: i18n.formatPercent(northJune.targetGapRatio, PCT_UNSIGNED),
                orders: i18n.formatPercent(northJune.ordersChangeRatio, PCT_UNSIGNED),
              },
              { isolateParams: "ltr" },
            )}
          </p>
          <p className="rf-finding-card__figure">
            <Bidi dir="ltr" className="rf-numeric">
              {i18n.formatCurrency(northJune.revenue, "USD", { maxFractionDigits: 0 })}
            </Bidi>
            <span className="rf-finding-card__vs">
              {" "}
              /{" "}
              <Bidi dir="ltr" className="rf-numeric">
                {i18n.formatCurrency(northJune.targetRevenue, "USD", { maxFractionDigits: 0 })}
              </Bidi>
            </span>
            <span className="rf-finding-card__gap">
              <Bidi dir="ltr" className="rf-numeric">
                −{i18n.formatPercent(northJune.targetGapRatio, PCT_UNSIGNED)}
              </Bidi>
            </span>
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              onManualInteraction();
              dispatch({ type: "toggle-evidence" });
            }}
            aria-expanded={state.evidenceOpen}
            aria-controls="rf-preview-evidence"
          >
            {i18n.t("action.showWhy")}
          </Button>

          {state.evidenceOpen ? (
            <div
              id="rf-preview-evidence"
              className="rf-evidence"
              data-testid="preview-evidence"
            >
              <dl className="rf-evidence__rows">
                <div>
                  <dt>{i18n.t("common.actual")}</dt>
                  <dd>
                    <Bidi dir="ltr" className="rf-mono">
                      {i18n.formatInteger(northJune.revenue)}
                    </Bidi>
                  </dd>
                </div>
                <div>
                  <dt>{i18n.t("common.target")}</dt>
                  <dd>
                    <Bidi dir="ltr" className="rf-mono">
                      {i18n.formatInteger(northJune.targetRevenue)}
                    </Bidi>
                  </dd>
                </div>
                <div>
                  <dt>{i18n.t("evidence.calculation")}</dt>
                  <dd>
                    <Bidi dir="ltr" className="rf-mono">
                      {`(${i18n.formatInteger(northJune.targetRevenue)} − ${i18n.formatInteger(northJune.revenue)}) / ${i18n.formatInteger(northJune.targetRevenue)} = ${i18n.formatPercent(northJune.targetGapRatio, PCT_UNSIGNED)}`}
                    </Bidi>
                  </dd>
                </div>
                <div>
                  <dt>{landingCopy(i18n.locale, "evidence.scope")}</dt>
                  <dd>
                    {landingCopy(i18n.locale, "common.scopeValue", {
                      region: i18n.t("region.North"),
                      period: i18n.t("period.june2026"),
                      sheet: dataset.sheetName,
                    })}
                  </dd>
                </div>
                <div>
                  <dt>{i18n.t("evidence.sourceRows")}</dt>
                  <dd>
                    <Bidi dir="ltr" className="rf-mono">
                      {`Operations!R${truth.northJune.sourceSpan.start}:R${truth.northJune.sourceSpan.end}`}
                    </Bidi>
                  </dd>
                </div>
                <div>
                  <dt>{i18n.t("evidence.hash")}</dt>
                  <dd>
                    <Bidi dir="ltr" className="rf-mono">
                      {hashShort}…
                    </Bidi>
                  </dd>
                </div>
              </dl>
              <p className="rf-evidence__note">
                <Icon name="check" size={16} /> {i18n.t("common.verified")} ·{" "}
                {i18n.t("evidence.hashNote")}
              </p>
            </div>
          ) : null}
        </m.div>
      </Target>

      {/* Scenario chapter — immutable observed baseline vs amber layer. */}
      <Target step="scenario" active={guideStep}>
        <div className="rf-scenario" data-testid="preview-scenario">
          <div className="rf-scenario__head">
            <div>
              <h3 className="rf-scenario__title">{i18n.t("scenario.title")}</h3>
              <p className="rf-scenario__scope">
                {i18n.t("scenario.scope", { scope: i18n.t("common.allRegions") })}
              </p>
            </div>
            <output
              className="rf-scenario__value"
              htmlFor="rf-cost-range"
              aria-live="off"
            >
              <Bidi dir="ltr" className="rf-numeric">
                {i18n.formatPercent(state.scenarioRatio, PCT)}
              </Bidi>
            </output>
          </div>
          <label className="rf-scenario__label" htmlFor="rf-cost-range">
            {i18n.t("scenario.costChange")}
          </label>
          <input
            id="rf-cost-range"
            className="rf-scenario__range"
            data-testid="scenario-range"
            type="range"
            min={-20}
            max={30}
            step={0.1}
            value={Number(state.scenarioRatio) * 100}
            onChange={(event) => {
              onManualInteraction();
              dispatch({
                type: "set-scenario",
                ratio: divideDecimal(event.currentTarget.value, "100"),
              });
            }}
          />
          {/* Paired bars on a fixed scale: observed baseline (cobalt, solid)
              vs assumption layer (amber, dashed outline). */}
          <div className="rf-scenario__bars" dir="ltr" role="img"
            aria-label={`${landingCopy(i18n.locale, "scenario.contributionLabel")}: ${i18n.formatInteger(june.baselineContribution)} → ${i18n.formatInteger(scenario.contribution)}`}
          >
            <div className="rf-scenario__bar-row">
              <span className="rf-scenario__bar-label">{landingCopy(i18n.locale, "scenario.observed")}</span>
              <span className="rf-scenario__track">
                <span className="rf-scenario__bar rf-scenario__bar--baseline" style={{ inlineSize: `${basePct}%` }} />
              </span>
              <span className="rf-scenario__bar-value rf-numeric">
                {i18n.formatInteger(june.baselineContribution)}
              </span>
            </div>
            <div className="rf-scenario__bar-row">
              <span className="rf-scenario__bar-label">{landingCopy(i18n.locale, "scenario.assumed")}</span>
              <span className="rf-scenario__track">
                <span
                  className="rf-scenario__bar rf-scenario__bar--scenario"
                  style={{ inlineSize: `${scenPct}%` }}
                />
              </span>
              <span className="rf-scenario__bar-value rf-numeric">
                {i18n.formatInteger(scenario.contribution)}
              </span>
            </div>
          </div>
          <p className="rf-scenario__result">
            {i18n.t(
              "scenario.result",
              {
                baseline: baselineMarginPct,
                scenario: scenarioMarginPct,
                delta: marginDeltaPp === null ? "—" : i18n.formatInteger(marginDeltaPp),
              },
              { isolateParams: "ltr" },
            )}
          </p>
          <p className="rf-scenario__note">
            {i18n.t("limitations.contribution")} {i18n.t("limitations.noForecast")}
          </p>
        </div>
      </Target>

      {/* Export chapter — the six authored compositions + workbook. */}
      <Target step="briefing" active={guideStep}>
        <div className="rf-briefing" data-testid="preview-briefing">
          <div className="rf-briefing__head">
            <h3 className="rf-briefing__title">{i18n.t("export.title")}</h3>
            <Button
              variant="secondary"
              onClick={() => {
                onManualInteraction();
                dispatch({ type: "prepare-briefing" });
              }}
              disabled={state.briefingReady}
            >
              {i18n.t("action.prepare")}
            </Button>
          </div>
          <ol className="rf-briefing__slides" aria-label={i18n.t("export.preview")}>
            {([1, 2, 3, 4, 5, 6] as const).map((n) => (
              <li key={n} className="rf-briefing__slide" data-ready={state.briefingReady || undefined}>
                <span className="rf-briefing__slide-num rf-numeric" dir="ltr">
                  {landingCopy(i18n.locale, "export.deckSlides", { n })}
                </span>
                <span className="rf-briefing__slide-title">{landingCopy(i18n.locale, `export.slide.${n}`)}</span>
                <span className="rf-briefing__state">
                  {state.briefingReady ? <Icon name="check" size={16} /> : "—"}
                </span>
              </li>
            ))}
          </ol>
          <p className="rf-briefing__workbook" data-ready={state.briefingReady || undefined}>
            <Icon name="file" size={16} />
            {landingCopy(i18n.locale, "export.workbookSummary")}
            <span className="rf-briefing__state">
              {state.briefingReady ? <Icon name="check" size={16} /> : "—"}
            </span>
          </p>
          <p className="rf-briefing__note">{i18n.t("export.previewNote")} {landingCopy(i18n.locale, "export.realDownloads")}</p>
          {state.briefingReady ? (
            <Button variant="primary" iconEnd="arrow-end" onClick={onOpenWorkspace}>
              {landingCopy(i18n.locale, "action.openWorkspace")}
            </Button>
          ) : null}
        </div>
      </Target>

      {guideVisible ? <div className="rf-preview__guide">{children}</div> : null}

      <p className="rf-stage__note">{landingCopy(i18n.locale, "landing.specimen.note")}</p>
    </section>
  );
}
