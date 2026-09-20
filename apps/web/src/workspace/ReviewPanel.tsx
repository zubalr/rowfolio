import { useMemo, useState } from 'react';
import type { QualityIssue } from '@rowfolio/contracts';
import { Button, Section } from '@rowfolio/ui';
import type { MessageKey } from '@rowfolio/i18n';
import { useI18n, useServices, useSessionState } from '../app/context.tsx';

const ACTION_LABEL: Record<QualityIssue['action'], MessageKey> = {
  'exclude-row': 'quality.duplicate' as MessageKey,
  'map-category': 'quality.category' as MessageKey,
  'use-cache': 'quality.proposed' as MessageKey,
  'confirm-type': 'quality.proposed' as MessageKey,
  none: 'quality.missing' as MessageKey,
};

/**
 * Needs-review panel — proposed normalizations require explicit approval.
 * The committed plan is exactly the checked set; nothing is auto-approved.
 */
export function ReviewPanel() {
  const i18n = useI18n();
  const { controller } = useServices();
  const pending = useSessionState().pending;
  const issues = useMemo(() => pending?.issues ?? [], [pending]);
  const columns = pending?.proposedColumns ?? [];
  const actionable = issues.filter((i) => i.action !== 'none');
  const disclosed = issues.filter((i) => i.action === 'none');
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(actionable.map((i) => i.id)));

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Section
      title={i18n.tSafe('quality.preview' as MessageKey)}
      meta={i18n.tSafe('quality.issues' as MessageKey) + `: ${issues.length}`}
    >
      <p className="rf-quiet">{i18n.tSafe('upload.duplicateWarning' as MessageKey)}</p>
      <ul className="rf-review-list">
        {actionable.map((issue) => (
          <li key={issue.id} className="rf-review-item">
            <label className="rf-review-label">
              <input
                type="checkbox"
                checked={checked.has(issue.id)}
                onChange={() => toggle(issue.id)}
              />
              <span className="rf-review-kind">{i18n.tSafe(ACTION_LABEL[issue.action])}</span>
              <span className="rf-quiet" dir="ltr">
                R{issue.sourceRow}
                {issue.original !== null ? ` · “${issue.original}”` : ''}
                {issue.normalized !== null ? ` → “${issue.normalized}”` : ''}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {disclosed.length > 0 && (
        <p className="rf-quiet">
          {i18n.tSafe('quality.unresolved' as MessageKey)}: {disclosed.length} · {i18n.tSafe('quality.noImputation' as MessageKey)}
        </p>
      )}
      <div className="rf-review-actions">
        <Button
          variant="primary"
          icon="check"
          onClick={() => void controller.approveReview([...checked], columns)}
          disabled={pending === null}
        >
          {i18n.tSafe('action.approve' as MessageKey)}
        </Button>
        <Button variant="secondary" onClick={() => controller.cancelWork('review rejected')}>
          {i18n.tSafe('action.back' as MessageKey)}
        </Button>
      </div>
    </Section>
  );
}
