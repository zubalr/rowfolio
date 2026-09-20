import { m } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useI18n } from '../app/context.tsx';
import type { MessageKey } from '@rowfolio/i18n';
import type { Finding } from '@rowfolio/contracts';
import { findingTestId } from './findingCopy.ts';

/**
 * The evidence badge on the hero stage — the visual half of the "badge →
 * drawer" transition. While this finding's evidence is open the chip stays
 * mounted but hidden so the matching badge inside the drawer owns the
 * layoutId; on close, focus/hierarchy returns here without a jump.
 */
export function EvidenceChip({
  findingId,
  hidden,
  onOpen,
}: {
  findingId: string;
  hidden: boolean;
  onOpen: () => void;
}) {
  const i18n = useI18n();
  const wasHidden = useRef(false);

  // The drawer's focus-restore targets this chip, which is hidden while open —
  // focus() on it is a no-op and focus drops to <body>. Recover by handing
  // focus to this finding's list trigger once the chip is visible again. The
  // activeElement guard keeps us from stealing focus the dialog restored fine.
  useEffect(() => {
    if (wasHidden.current && !hidden) {
      const active = document.activeElement;
      if (active === null || active === document.body) {
        document
          .querySelector<HTMLElement>(
            `[data-testid="${findingTestId({ id: findingId } as Finding)}"] [data-testid="view-evidence-btn"]`,
          )
          ?.focus();
      }
    }
    wasHidden.current = hidden;
  }, [hidden, findingId]);

  return (
    <m.button
      type="button"
      layoutId={evidenceChipId(findingId)}
      className="rf-ev-chip"
      onClick={onOpen}
      style={{ visibility: hidden ? 'hidden' : 'visible' }}
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden || undefined}
    >
      {i18n.tSafe('action.showWhy' as MessageKey)}
    </m.button>
  );
}

export function evidenceChipId(findingId: string): string {
  return `rf-ev-chip-${findingId}`;
}
