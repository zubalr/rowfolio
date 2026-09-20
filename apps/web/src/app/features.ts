import { lazy, type ComponentType } from 'react';
import type { LandingAppProps } from '../landing/LandingApp.tsx';
import type { UploadFlowProps } from '../upload/UploadFlow.tsx';
import type { EvidenceDialogProps } from '../evidence/EvidenceDialog.tsx';

/**
 * Feature slots — owner packages (landing A12, upload A17, evidence A13)
 * are discovered by directory convention. Globs stay LAZY so their barrels
 * never land in the entry chunk (landing budget is enforced); each slot
 * renders inside <Suspense> at the call site.
 *
 * Slots are resolved once at module init — `import.meta.glob` is evaluated
 * statically by Vite at build time.
 */
const landingEntry = import.meta.glob<Record<string, unknown>>('../landing/index.{ts,tsx}');
const uploadEntry = import.meta.glob<Record<string, unknown>>('../upload/index.{ts,tsx}');
const evidenceEntry = import.meta.glob<Record<string, unknown>>('../evidence/index.{ts,tsx}');

function slot<TProps>(
  loaders: Record<string, () => Promise<Record<string, unknown>>>,
  name: string,
): ComponentType<TProps> | null {
  const load = Object.values(loaders)[0];
  if (!load) return null;
  return lazy(async () => {
    const mod = await load();
    const component = mod[name];
    if (typeof component !== 'function') {
      throw new Error(`feature slot ${name} missing from resolved module`);
    }
    return { default: component as ComponentType<TProps> };
  });
}

export interface FeatureSlots {
  /** Real landing surface — self-contained (intent + navigation internal). */
  readonly LandingApp: ComponentType<LandingAppProps> | null;
  /** Staged upload wizard (dropzone → configure → parse → review). */
  readonly UploadFlow: ComponentType<UploadFlowProps> | null;
  /** Dark evidence dialog bound to provenance services. */
  readonly EvidenceDialog: ComponentType<EvidenceDialogProps> | null;
}

let resolved: FeatureSlots | null = null;

export function resolveFeatures(): FeatureSlots {
  if (!resolved) {
    resolved = {
      LandingApp: slot<LandingAppProps>(landingEntry, 'LandingApp'),
      UploadFlow: slot<UploadFlowProps>(uploadEntry, 'UploadFlow'),
      EvidenceDialog: slot<EvidenceDialogProps>(evidenceEntry, 'EvidenceDialog'),
    };
  }
  return resolved;
}
