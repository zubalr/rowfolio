import { m } from 'motion/react';
import { useI18n } from '../app/context.tsx';
import type { MessageKey } from '@rowfolio/i18n';

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
