/**
 * Public entry surface for `@rowfolio/normalize`.
 *
 * Only the contract-assigned signatures cross the package boundary:
 * `profileTable` proposes, `normalizeTable` applies explicit approvals.
 * Helpers (`columnLetter`, `foldKey`, revision builders) are exported for
 * testability; engine internals stay module-private.
 */
import type { RawTable } from '@rowfolio/contracts';
import type {
  ApprovalPlan,
  NormalizeTable,
  ProfileTable,
} from '@rowfolio/contracts/interfaces';

export type { ApprovalPlan, RawTable };
export type { NormalizeTable, ProfileTable };
export { profileTable } from './profile.ts';
export type { CellIndex, ProfileResult } from './profile.ts';
export {
  cellAt,
  columnLetter,
  foldKey,
  indexCells,
  significantDigitsOf,
  slugColumnId,
} from './profile.ts';
export { normalizeTable, normalizationRevisionOf, originalValue } from './normalize.ts';
export type { RevisionPayload } from './normalize.ts';
export { NormalizeError } from './normalize.ts';
export { sha256HexBytes, sha256HexUtf8 } from './sha256.ts';
