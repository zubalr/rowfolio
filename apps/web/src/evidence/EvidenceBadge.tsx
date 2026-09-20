/**
 * EvidenceBadge — the badge the workspace evidence chip morphs into. It
 * carries the sheet name (the finding's source identity) and shares the
 * chip's `layoutId`, so the badge→drawer transition reads as one element
 * traveling, not two appearing.
 *
 * Self-wrapped in LazyMotion: the evidence test harness mounts the panel
 * outside the workspace's MotionConfig, and `m` components require a
 * feature bundle in scope.
 */
import { LazyMotion, MotionConfig, domAnimation, m } from 'motion/react';
import { Icon } from '@rowfolio/ui';
import { evidenceChipId } from '../workspace/EvidenceChip.tsx';

export function EvidenceBadge({ findingId, label }: { findingId: string; label: string }) {
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <m.span
          layoutId={evidenceChipId(findingId)}
          className="rf-ev-chip rf-ev-chip--badge"
          dir="ltr"
        >
          <Icon name="file" size={16} />
          {label}
        </m.span>
      </MotionConfig>
    </LazyMotion>
  );
}
