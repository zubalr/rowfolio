/**
 * Public entry surface for `@rowfolio/analysis`.
 *
 * Only the contract-assigned `analyze` signature crosses the package
 * boundary. Scope mechanics, comparison rules and the sample pack are
 * exported for testability; arithmetic stays in contracts.
 */
import type { Analyze } from '@rowfolio/contracts/interfaces';
import { analyze as analyzeImpl } from './analyze.ts';

export type { Analyze };
export { analyze, qualitySummaryOf, snapshotId, topFindings } from './analyze.ts';
export { compareFindings } from './analyze.ts';
export { AnalysisError } from './analyze.ts';
export {
  buildSamplePack,
  evaluateOutliers,
  evaluateTrends,
  hasSampleColumns,
  summarizeMonthly,
  trailingMonths,
} from './sample.ts';
export { SamplePackError } from './sample.ts';
export {
  findDateColumn,
  findRegionColumn,
  isPeriodComplete,
  previousMonthPeriod,
  scopeRows,
  sharedMask,
  sumField,
  toSpans,
} from './scope.ts';
export {
  absDecimal,
  describe,
  domainMax,
  iqrFlag,
  quantileType7,
  relativeChange,
  trendDirection,
} from './mechanics.ts';

export const analyzeApi: Analyze = analyzeImpl;
