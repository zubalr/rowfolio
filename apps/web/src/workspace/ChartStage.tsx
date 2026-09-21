import type { AnalysisSnapshot } from '@rowfolio/contracts';
import { ChartFigure } from '@rowfolio/charts';
import { chartLocalization } from './chartLocalization.ts';
import { useI18n, useServices, useSessionState } from '../app/context.tsx';
import type { MessageKey } from '@rowfolio/i18n';
import { chartFinding, emphasisKeyFor, heroChart } from './stageModel.ts';
import { EvidenceChip } from './EvidenceChip.tsx';
import { findingTitle } from './findingCopy.ts';
import { formatScope } from '../evidence/model.ts';

/**
 * Overview: one hero chart — the chart the selected finding is about — on
 * the overview plate, named by the finding's headline with its analysis
 * scope beside it and the evidence badge that morphs into the drawer.
 * Remaining charts follow on the standard grid, each marking the datum its
 * finding claims.
 */
export function ChartStage({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const i18n = useI18n();
  const { controller } = useServices();
  const state = useSessionState();
  const selected = snapshot.findings.find((f) => f.id === state.selectedFindingId) ?? null;
  const hero = heroChart(snapshot, selected);
  const heroFinding = hero === null ? null : (chartFinding(snapshot, hero.id) ?? selected);
  const restCharts =
    hero === null ? snapshot.charts : snapshot.charts.filter((c) => c.id !== hero.id);
  const localization = chartLocalization(i18n);

  return (
    <div className="rf-stage" id="overview">
      {hero === null ? null : (
        <div className="rf-stage-panel">
          <header className="rf-stage-head">
            <div className="rf-stage-titles">
              {heroFinding === null ? null : (
                <p className="rf-stage-eyebrow">
                  {i18n.tSafe('a11y.selectedFinding' as MessageKey)}
                </p>
              )}
              <h3 className="rf-stage-title">
                {heroFinding === null
                  ? i18n.tSafe(hero.titleKey as MessageKey)
                  : findingTitle(i18n, heroFinding)}
              </h3>
              <p className="rf-stage-scope">{formatScope(i18n, hero.scope)}</p>
            </div>
            {heroFinding === null ? null : (
              <EvidenceChip
                findingId={heroFinding.id}
                hidden={state.evidenceFindingId === heroFinding.id}
                onOpen={() => controller.openEvidence(heroFinding.id)}
              />
            )}
          </header>
          <ChartFigure
            spec={hero}
            localization={localization}
            emphasisKey={emphasisKeyFor(hero, heroFinding)}
          />
        </div>
      )}
      <div className={`rf-charts${hero === null ? '' : ' rf-charts--paired'}`}>
        {restCharts.map((spec) => {
          const finding = chartFinding(snapshot, spec.id);
          return (
            <ChartFigure
              key={spec.id}
              spec={spec}
              localization={localization}
              emphasisKey={emphasisKeyFor(spec, finding)}
            />
          );
        })}
      </div>
    </div>
  );
}
