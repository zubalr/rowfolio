/**
 * Versioned policy constants — the arithmetic and ingestion guardrails every
 * package must honor (source/policy.json). Provenance rows carry
 * `policyVersion`; it must equal POLICY.version.
 */
import policyJson from '../source/policy.json';

export interface RowfolioPolicy {
  readonly version: string;
  readonly numeric: {
    readonly precision: number;
    readonly rounding: 'ROUND_HALF_UP';
    readonly maxInputSignificantDigits: number;
    readonly maxInputExponent: number;
    readonly excelNumericMaxSignificantDigits: number;
  };
  readonly limits: {
    readonly compressedBytes: number;
    readonly expandedBytes: number;
    readonly entryBytes: number;
    readonly entries: number;
    readonly expansionRatio: number;
    readonly rowsIncludingHeader: number;
    readonly columns: number;
    readonly nonemptyCells: number;
    readonly visibleSheets: number;
    readonly cellCharacters: number;
    readonly watchdogMs: number;
  };
  readonly thresholds: {
    readonly numericInferenceFraction: string;
    readonly dateInferenceFraction: string;
    readonly minComparisonRows: number;
    readonly targetGapFraction: string;
    readonly periodChangeFraction: string;
    readonly minAbsoluteChangeShareOfPriorScope: string;
    readonly ordersIncreaseFraction: string;
    readonly outlierMinRows: number;
    readonly iqrMultiplier: string;
    readonly trendMinPeriods: number;
  };
  readonly ranking: {
    readonly sampleTopRuleIds: readonly string[];
    readonly note: string;
  };
}

/** Active policy document. Validators check `policyVersion`/`precision`/`rounding` against it. */
export const POLICY: RowfolioPolicy = policyJson as RowfolioPolicy;
