/**
 * PreviewStage — the landing's interactive raw → finding → briefing preview.
 * Everything shown is the prepared sample's verified truth computed by
 * `previewTruth.ts` from the checked-in oracle fixture; it is labeled
 * "Prepared sample" / synthetic and never implies on-demand analysis.
 *
 * Manual controls (Show me why, the cost-change range, Prepare, Replay)
 * dispatch the same preview actions the DemoController dispatches as a
 * host — the guide is a driver of the real surface, not a fake cursor.
 */
import type { ReactNode } from "react";
import { Button, Bidi, DataTable, Icon } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import { divideDecimal, subtractDecimal } from "@rowfolio/contracts";
import type { LandingPreviewTruth } from "./previewTruth.ts";
import type { PreviewAction, PreviewState } from "./previewState.ts";

export interface PreviewStageProps {
  readonly truth: LandingPreviewTruth;
  readonly i18n: I18n;
  readonly state: PreviewState;
  readonly dispatch: (action: PreviewAction) => void;
  /** Active guide step id, or null — marks the current demo target region. */
  readonly guideStep: string | null;
  /** True while the guide bar should stay mounted (running/paused/complete/error). */
  readonly guideVisible: boolean;
  /** Manual-interaction hook: pauses the guide without exiting it. */
  readonly onManualInteraction: () => void;
  readonly onReplay: () => void;
  /** Slot rendered inside the stage (guide controls). */
  readonly children?: ReactNode;
}

const PCT = { minFractionDigits: 0, maxFractionDigits: 1, signDisplay: "exceptZero" } as const;
const PCT_UNSIGNED = { minFractionDigits: 0, maxFractionDigits: 1 } as const;

function Target({
  step,
  active,
  children,
  className,
}: {
  step: string;
  active: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-demo-target={step}
      data-demo-active={active === step ? "" : undefined}
      className={className}
    >
      {children}
    </div>
  );
}

export function PreviewStage({
  truth,
  i18n,
  state,
  dispatch,
  guideStep,
  guideVisible,
  onManualInteraction,
  onReplay,
  children,
}: PreviewStageProps) {
  const { northJune, june, dataset } = truth;
  const scenario = truth.computeScenario(state.scenarioRatio);
  const baselineMarginPct = i18n.formatPercent(june.baselineMargin, { maxFractionDigits: 0 });
  const scenarioMarginPct =
    scenario.margin === null
      ? i18n.tSafe("common.undefined")
      : i18n.formatPercent(scenario.margin, { maxFractionDigits: 0 });
  // Percentage-point delta of margin (0.19 − 0.25 = −0.06 → −6 pp).
  const marginDeltaPp =
    scenario.margin === null
      ? null
      : divideDecimal(subtractDecimal(scenario.margin, june.baselineMargin), "0.01");

  const hashShort = dataset.sha256.slice(0, 12);

  return (
    <section
      className="rf-preview"
      id="demo"
      aria-labelledby="rf-preview-title"
      data-testid="preview-stage"
    >
      <header className="rf-preview__head">
        <div>
          <h2 id="rf-preview-title" className="rf-preview__title" tabIndex={-1}>
            {i18n.t("workspace.findings")}
          </h2>
          <p className="rf-preview__meta">
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

      <div className="rf-preview__grid">
        <Target step="findings" active={guideStep} className="rf-preview__raw">
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

        <Target step="evidence" active={guideStep}>
          <div
            className="rf-finding"
            data-rf-surface="ink"
            data-testid="preview-finding"
            data-revealed={state.revealed ? "" : undefined}
          >
            <span className="rf-finding__eyebrow">{i18n.t("workspace.findings")}</span>
            <h3 className="rf-finding__title">{i18n.t("finding.north.title")}</h3>
            <p className="rf-finding__body">
              {i18n.t(
                "finding.north.body",
                {
                  gap: i18n.formatPercent(northJune.targetGapRatio, PCT_UNSIGNED),
                  orders: i18n.formatPercent(northJune.ordersChangeRatio, PCT_UNSIGNED),
                },
                { isolateParams: "ltr" },
              )}
            </p>
            <p className="rf-finding__figure">
              <Bidi dir="ltr" className="rf-numeric">
                {i18n.formatCurrency(northJune.revenue, "USD", { maxFractionDigits: 0 })}
              </Bidi>
              <span className="rf-finding__vs">
                {" "}
                /{" "}
                <Bidi dir="ltr" className="rf-numeric">
                  {i18n.formatCurrency(northJune.targetRevenue, "USD", { maxFractionDigits: 0 })}
                </Bidi>
              </span>
              <span className="rf-finding__gap">
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
          </div>
        </Target>
      </div>

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
          <ul className="rf-briefing__files" aria-label={i18n.t("export.preview")}>
            {(["action.saveWorkbook", "action.saveDeck"] as const).map((key) => (
              <li key={key} className="rf-briefing__file" data-ready={state.briefingReady || undefined}>
                <Icon name="file" size={18} />
                <span>{i18n.t(key)}</span>
                <span className="rf-briefing__state">
                  {state.briefingReady ? i18n.t("common.verified") : "—"}
                </span>
              </li>
            ))}
          </ul>
          <p className="rf-briefing__note">{i18n.t("export.previewNote")}</p>
        </div>
      </Target>

      {guideVisible ? <div className="rf-preview__guide">{children}</div> : null}
    </section>
  );
}


