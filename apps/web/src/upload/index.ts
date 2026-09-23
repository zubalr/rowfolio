/**
 * apps/web/src/upload — conservative real-upload UX (task A17).
 *
 * Public surface: the staged `UploadFlow` component, the framework-free
 * `createUploadController` state machine, `useUploadController` for React, the
 * real `ingestPorts()` adapter binding, and pure view-model derivations. The
 * committed result is `UploadOutcome` — the real parsed table, the exact
 * `ParseOptions` used and the contract `ApprovalPlan` for normalization.
 */
export { UploadFlow } from "./UploadFlow.tsx";
export type { UploadFlowProps } from "./UploadFlow.tsx";
export { createUploadController } from "./controller.ts";
export { useUploadController } from "./useUpload.ts";
export { ingestPorts } from "./adapters.ts";
export {
  ambiguityKind,
  columnLetter,
  deriveCapabilities,
  effectiveColumns,
  groupIssues,
  pendingColumns,
  previewModel,
  sampleValues,
  sheetChoices,
  suggestHeaderRow,
  warningMessageKey,
} from "./derive.ts";
export type { CapabilitySummary, IssueGroups, PreviewModel, SheetChoice } from "./derive.ts";
export type {
  ApprovalPlan,
  CsvDelimiter,
  ParseOptions,
  ProfileTable,
  Progress,
  UploadController,
  UploadControllerCallbacks,
  UploadDecisions,
  UploadFailure,
  UploadFileRef,
  UploadOutcome,
  UploadPorts,
  UploadProgress,
  UploadSelection,
  UploadState,
} from "./types.ts";
