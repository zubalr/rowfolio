import type { AnalysisSnapshot, Finding } from '@rowfolio/contracts';
import { useI18n, useServices, useSessionState } from '../app/context.tsx';
import type { MessageKey } from '@rowfolio/i18n';
import { findingBody, findingTestId, findingTitle } from './findingCopy.ts';

/**
 * Finding list — the editorial spine. Clicking selects; "View calculation" opens
 * the evidence drawer for the finding's provenance.
 */
export function FindingList({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const i18n = useI18n();
  const { controller } = useServices();
  const findings = snapshot.findings;

  if (findings.length === 0) {
    return <p className="rf-quiet">{i18n.tSafe('empty.noFindings' as MessageKey)}</p>;
  }

  return (
    <ul className="rf-findings" id="findings">
      {findings.map((finding) => (
        <FindingCard key={finding.id} snapshot={snapshot} finding={finding} onEvidence={() => controller.openEvidence(finding.id)} />
      ))}
    </ul>
  );
}

function FindingCard({
  snapshot,
  finding,
  onEvidence,
}: {
  snapshot: AnalysisSnapshot;
  finding: Finding;
  onEvidence: () => void;
}) {
  const i18n = useI18n();
  const { controller } = useServices();
  const selected = useSessionState().selectedFindingId === finding.id;

  return (
    <li
      className={`rf-finding${selected ? ' is-selected' : ''} rf-severity-${finding.severity}`}
      data-testid={findingTestId(finding)}
    >
      <button
        type="button"
        className="rf-finding-main"
        onClick={() => controller.selectFinding(finding.id)}
        aria-pressed={selected}
      >
        <span className="rf-finding-title">{findingTitle(i18n, finding)}</span>
        <span className="rf-finding-body">{findingBody(i18n, snapshot, finding)}</span>
        {finding.limitations.length > 0 && (
          <span className="rf-finding-limits">
            {finding.limitations.map((key) => (
              <span key={key} className="rf-limitation">{i18n.tSafe(key as MessageKey)}</span>
            ))}
          </span>
        )}
      </button>
      <button
        type="button"
        className="rf-linkbtn"
        onClick={onEvidence}
        data-testid="view-evidence-btn"
      >
        {i18n.tSafe('action.showWhy' as MessageKey)}
      </button>
    </li>
  );
}
