import type { AnalysisSnapshot, Finding } from '@rowfolio/contracts';
import { Button, Section } from '@rowfolio/ui';
import { useI18n, useServices, useSessionState } from '../app/context.tsx';
import type { MessageKey } from '@rowfolio/i18n';
import { findingBody, findingTestId, findingTitle } from './findingCopy.ts';

/**
 * Finding list — the editorial spine. Clicking selects; "Show me why" opens
 * the evidence drawer for the finding's provenance.
 */
export function FindingList({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const i18n = useI18n();
  const { controller } = useServices();
  const findings = snapshot.findings;

  if (findings.length === 0) {
    return (
      <Section title={i18n.tSafe('workspace.findings' as MessageKey)}>
        <p className="rf-quiet">{i18n.tSafe('empty.noFindings' as MessageKey)}</p>
      </Section>
    );
  }

  return (
    <Section title={i18n.tSafe('workspace.findings' as MessageKey)} id="findings">
      <ul className="rf-findings">
        {findings.map((finding) => (
          <FindingCard key={finding.id} snapshot={snapshot} finding={finding} onEvidence={() => controller.openEvidence(finding.id)} />
        ))}
      </ul>
    </Section>
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
      <Button
        variant="secondary"
        icon="info"
        onClick={onEvidence}
        data-testid="view-evidence-btn"
      >
        {i18n.tSafe('action.showWhy' as MessageKey)}
      </Button>
    </li>
  );
}
