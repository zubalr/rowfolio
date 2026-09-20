import type { AnalysisSnapshot } from '@rowfolio/contracts';
import { ChartFigure } from '@rowfolio/charts';
import { Section } from '@rowfolio/ui';
import { useI18n, useSessionState } from '../app/context.tsx';
import type { MessageKey } from '@rowfolio/i18n';
import { chartLocalization } from './chartLocalization.ts';

/** Charts bound to the snapshot; the selected finding's chart leads. */
export function ChartStage({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const i18n = useI18n();
  const selectedId = useSessionState().selectedFindingId;
  const selected = snapshot.findings.find((f) => f.id === selectedId);

  const ordered = [...snapshot.charts].sort((a, b) => {
    const aSel = selected?.chartId === a.id ? 0 : 1;
    const bSel = selected?.chartId === b.id ? 0 : 1;
    return aSel - bSel;
  });

  if (ordered.length === 0) return null;
  const localization = chartLocalization(i18n);
  return (
    <Section title={i18n.tSafe('workspace.overview' as MessageKey)}>
      <div className="rf-charts">
        {ordered.map((spec) => (
          <ChartFigure key={spec.id} spec={spec} localization={localization} />
        ))}
      </div>
    </Section>
  );
}
