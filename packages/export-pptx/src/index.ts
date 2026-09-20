/**
 * Public entry surface for `@rowfolio/export-pptx`.
 *
 * Only the contract-assigned `buildPresentation` signature crosses the
 * package boundary. The PptxGenJS dependency never leaks across it (bytes
 * travel out of band with explicit metadata).
 */
export { buildPresentation, ExportPptxError } from './presentation.ts';
export type { BuiltArtifact, Progress } from './presentation.ts';
