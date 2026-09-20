/**
 * Public entry surface for `@rowfolio/export-model`.
 *
 * Only the contract-assigned `buildExportModel` signature crosses the
 * package boundary. Copy tables, parity checks and id helpers are
 * exported for testability; writers consume the model read-only.
 */
export {
  baselineMarginOf,
  buildExportModel,
  isSampleModel,
  localizeDigits,
  numericParity,
  periodLabel,
} from './model.ts';
export { ExportModelError } from './model.ts';
export { TEMPLATE_VERSION } from './model.ts';
