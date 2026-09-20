import type { ComponentType } from 'react';

/**
 * Feature-slot binding. A12 (landing), A17 (upload) and A13 (evidence) own
 * sibling directories under `apps/web/src/`. When their modules land they are
 * discovered here via `import.meta.glob` — no edits to this file or theirs.
 *
 * Contract: a feature module default-exports (or named-exports the canonical
 * component below) a React component accepting the slot props defined in
 * `slots.ts`. Missing slots fall back to the built-in minimal surfaces so the
 * composition always closes the loop.
 */
export interface FeatureSlots {
  Landing: ComponentType<Record<string, unknown>> | null;
  UploadZone: ComponentType<Record<string, unknown>> | null;
  EvidenceView: ComponentType<Record<string, unknown>> | null;
}

type ModuleRecord = Record<string, unknown>;

function pick(mod: ModuleRecord | undefined, names: readonly string[]): ComponentType<Record<string, unknown>> | null {
  if (!mod) return null;
  for (const name of names) {
    const candidate = mod[name];
    if (typeof candidate === 'function') return candidate as ComponentType<Record<string, unknown>>;
  }
  return null;
}

const landingModules = import.meta.glob<ModuleRecord>('../landing/index.{ts,tsx}', { eager: true });
const uploadModules = import.meta.glob<ModuleRecord>('../upload/index.{ts,tsx}', { eager: true });
const evidenceModules = import.meta.glob<ModuleRecord>('../evidence/index.{ts,tsx}', { eager: true });

function firstModule(modules: Record<string, ModuleRecord>): ModuleRecord | undefined {
  const keys = Object.keys(modules);
  return keys.length > 0 ? modules[keys[0]!] : undefined;
}

export function resolveFeatures(): FeatureSlots {
  return {
    Landing: pick(firstModule(landingModules), ['Landing', 'LandingPage', 'default']),
    UploadZone: pick(firstModule(uploadModules), ['UploadZone', 'UploadPanel', 'default']),
    EvidenceView: pick(firstModule(evidenceModules), ['EvidenceView', 'EvidencePanel', 'default']),
  };
}
