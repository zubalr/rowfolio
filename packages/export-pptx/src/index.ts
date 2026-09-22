/**
 * Public entry surface for `@rowfolio/export-pptx`.
 *
 * Only the contract-assigned `buildPresentation` signature crosses the
 * package boundary. The PptxGenJS dependency never leaks across it (bytes
 * travel out of band with explicit metadata).
 */
export { buildPresentation, ExportPptxError } from './presentation.ts';
export type { BuiltArtifact, Progress } from './presentation.ts';
// Shared copy/format surface: the in-app preview resolves the same labels and
// figures through these so the preview can never drift from the artifact.
export { hasLabel, label, metricDisplayName, scopeText } from './labels.ts';
export {
  formatCompact,
  formatFull,
  formatInteger,
  formatMetricValue,
  formatPercent,
  formatPp,
} from './format.ts';
// Shared slide-composition helpers: the in-app preview mirrors the deck
// layout-for-layout, so both resolve the same track metrics and row spans.
export { qualityTrackMetrics, spanTokensForModel } from './layouts.ts';
