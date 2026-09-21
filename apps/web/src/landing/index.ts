/**
 * @module landing — bilingual product entry for Rowfolio (A12).
 *
 * `LandingApp` renders the whole static entry; `createLandingI18n` builds
 * the provider pinned to the entry's `html[lang]`. Everything exported is
 * import-safe: no `window`/`document` access at module scope.
 */
export { LandingApp } from "./LandingApp.tsx";
export type { LandingAppProps } from "./LandingApp.tsx";
export { SpreadStage } from "./SpreadStage.tsx";
export type { SpreadStageProps } from "./SpreadStage.tsx";
export { LANDING_TRUTH } from "./previewTruth.ts";
export type { LandingPreviewTruth, PreviewScenarioResult } from "./previewTruth.ts";
export { createLandingI18n, localeOfDocument, persistLocaleChoice } from "./i18n.ts";
export { useReducedMotion, prefersReducedMotion } from "./useReducedMotion.ts";
export {
  WORKSPACE_ROUTE,
  navigateToWorkspace,
  scrollToId,
  focusById,
  siblingLocaleHref,
  workspaceHref,
} from "./routes.ts";
export { setWorkspaceIntent, takeWorkspaceIntent } from "./pendingUpload.ts";
export type { WorkspaceIntent } from "./pendingUpload.ts";
