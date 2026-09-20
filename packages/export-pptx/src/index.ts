/**
 * Public entry surface for `@rowfolio/export-pptx`.
 *
 * Only the contract-assigned `buildPresentation` signature crosses the
 * package boundary. The PptxGenJS dependency never leaks across it (bytes
 * travel out of band with explicit metadata).
 */
import type { BuildPresentation } from '@rowfolio/contracts/interfaces';
import { buildPresentation as buildPresentationImpl } from './presentation.ts';

export type { BuildPresentation };
export { buildPresentation, ExportPptxError } from './presentation.ts';

export const buildPresentationApi: BuildPresentation = buildPresentationImpl;
