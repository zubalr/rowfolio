/**
 * Public entry surface for `@rowfolio/export-xlsx`.
 *
 * Only the contract-assigned `buildWorkbook` signature crosses the package
 * boundary. Name guards and model limits are exported for testability;
 * the ExcelJS dependency never leaks across the boundary (bytes travel
 * out of band with explicit metadata).
 */
export {
  assertSafeSheetName,
  buildWorkbook,
  ExportXlsxError,
  validateModelLimits,
} from './workbook.ts';
export type { BuiltArtifact, Progress } from './workbook.ts';
export { MAX_CELL_CHARACTERS, MAX_EXPORT_DATA_ROWS } from './workbook.ts';
