/**
 * Preview truth for the landing demo surface.
 *
 * Every number shown in the landing preview is derived here — at module
 * init, with exact contract-decimal arithmetic — from the checked-in
 * independent oracle fixture `fixtures/sample/expected_monthly.json` and
 * the sample manifest. Nothing is hand-typed: if the fixture ever drifts,
 * `previewTruth.test.ts` fails against the golden report, not the UI.
 *
 * The raw excerpt rows below are verbatim physical rows from
 * `fixtures/sample/sample_operations.csv` (sha256 84c945daa1d4a452…),
 * which `fixtures/sample/artifact_binding.json` binds to the shipped
 * sample workbook.
 */
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  subtractDecimal,
  type Decimal,
} from "@rowfolio/contracts";
import expectedMonthly from "../../../../fixtures/sample/expected_monthly.json";
import sampleManifest from "../../../../fixtures/sample/sample_manifest.json";

interface MonthlyRow {
  readonly period: string;
  readonly region: string;
  readonly revenue: string;
  readonly target_revenue: string;
  readonly order_volume: number;
  readonly operating_cost: string;
  readonly downtime_minutes: number;
}

const rows = expectedMonthly as readonly MonthlyRow[];

function monthly(region: string, period: string): MonthlyRow {
  const row = rows.find((r) => r.region === region && r.period === period);
  if (row === undefined) {
    throw new Error(`previewTruth: fixture row missing for ${region}/${period}`);
  }
  return row;
}

function sumField(period: string, pick: (r: MonthlyRow) => string): Decimal {
  let acc: Decimal = "0";
  for (const r of rows) {
    if (r.period === period) acc = addDecimal(acc, pick(r));
  }
  return acc;
}

/** ratio = (current − previous) / previous — exact decimal, may be negative. */
function changeRatio(previous: Decimal, current: Decimal): Decimal {
  return divideDecimal(subtractDecimal(current, previous), previous);
}

const northMay = monthly("North", "2026-05");
const northJune = monthly("North", "2026-06");
const juneRevenue = sumField("2026-06", (r) => r.revenue);
const juneCost = sumField("2026-06", (r) => r.operating_cost);
const regionsJune = sampleManifest.regions.map((region) => {
  const r = monthly(region, "2026-06");
  return {
    region,
    revenue: r.revenue as Decimal,
    targetRevenue: r.target_revenue as Decimal,
    targetGapRatio: divideDecimal(
      subtractDecimal(r.target_revenue, r.revenue),
      r.target_revenue,
    ),
  };
});

export interface PreviewScenarioResult {
  readonly costChangeRatio: Decimal;
  readonly scenarioCost: Decimal;
  readonly contribution: Decimal;
  /** (revenue − cost) / revenue; null when revenue is nonpositive. */
  readonly margin: Decimal | null;
}

export interface LandingPreviewTruth {
  readonly dataset: {
    readonly fileName: string;
    readonly sheetName: string;
    readonly sha256: string;
    readonly rawRecords: number;
    readonly cleanRecords: number;
    readonly regionCount: number;
    readonly issueCount: number;
    readonly unresolvedIssues: number;
  };
  readonly northJune: {
    readonly revenue: Decimal;
    readonly targetRevenue: Decimal;
    /** (target − revenue) / target — positive when below target. */
    readonly targetGapRatio: Decimal;
    readonly ordersMay: Decimal;
    readonly ordersJune: Decimal;
    readonly ordersChangeRatio: Decimal;
    readonly downtimeMay: Decimal;
    readonly downtimeJune: Decimal;
    readonly downtimeChangeRatio: Decimal;
    /** One-based physical worksheet rows backing the June North figures. */
    readonly sourceSpan: { readonly sheet: string; readonly start: number; readonly end: number };
  };
  readonly june: {
    readonly revenue: Decimal;
    readonly operatingCost: Decimal;
    readonly baselineContribution: Decimal;
    readonly baselineMargin: Decimal;
  };
  /** All six regions' June revenue/target — feeds the specimen's comparison. */
  readonly regionsJune: readonly {
    readonly region: string;
    readonly revenue: Decimal;
    readonly targetRevenue: Decimal;
    readonly targetGapRatio: Decimal;
  }[];
  /** Bounds from the scenario contract: fraction ∈ [−0.20, +0.30], step 0.001. */
  readonly scenario: {
    readonly minRatio: Decimal;
    readonly maxRatio: Decimal;
    readonly stepRatio: Decimal;
  };
  readonly computeScenario: (costChangeRatio: Decimal) => PreviewScenarioResult;
  /** Verbatim leading physical rows of sample_operations.csv. */
  readonly excerpt: readonly string[][];
  readonly excerptColumns: readonly string[];
}

export const LANDING_TRUTH: LandingPreviewTruth = {
  dataset: {
    fileName: "sample_operations.xlsx",
    sheetName: sampleManifest.sourceSheet,
    sha256: sampleManifest.sourceCsvSha256,
    rawRecords: sampleManifest.rawRecords,
    cleanRecords: sampleManifest.cleanRecords,
    regionCount: sampleManifest.regions.length,
    issueCount: sampleManifest.quality.issueCount,
    unresolvedIssues: sampleManifest.quality.unresolved,
  },
  northJune: {
    revenue: northJune.revenue,
    targetRevenue: northJune.target_revenue,
    targetGapRatio: divideDecimal(
      subtractDecimal(northJune.target_revenue, northJune.revenue),
      northJune.target_revenue,
    ),
    ordersMay: String(northMay.order_volume),
    ordersJune: String(northJune.order_volume),
    ordersChangeRatio: changeRatio(String(northMay.order_volume), String(northJune.order_volume)),
    downtimeMay: String(northMay.downtime_minutes),
    downtimeJune: String(northJune.downtime_minutes),
    downtimeChangeRatio: changeRatio(
      String(northMay.downtime_minutes),
      String(northJune.downtime_minutes),
    ),
    // fixtures/golden/expected_source_spans.json — North × 2026-06 revenue/target.
    sourceSpan: { sheet: sampleManifest.sourceSheet, start: 1802, end: 1901 },
  },
  june: {
    revenue: juneRevenue,
    operatingCost: juneCost,
    baselineContribution: subtractDecimal(juneRevenue, juneCost),
    baselineMargin: divideDecimal(subtractDecimal(juneRevenue, juneCost), juneRevenue),
  },
  regionsJune,
  scenario: { minRatio: "-0.2", maxRatio: "0.3", stepRatio: "0.001" },
  computeScenario(costChangeRatio: Decimal): PreviewScenarioResult {
    const scenarioCost = multiplyDecimal(juneCost, addDecimal("1", costChangeRatio));
    const contribution = subtractDecimal(juneRevenue, scenarioCost);
    // Contract rule: a nonpositive revenue disables the margin metric.
    const margin =
      compareDecimal(juneRevenue, "0") <= 0 ? null : divideDecimal(contribution, juneRevenue);
    return { costChangeRatio, scenarioCost, contribution, margin };
  },
  excerptColumns: ["operation_id", "date", "region", "site", "revenue", "target_revenue"],
  // Physical worksheet rows 1802–1806 (CSV lines 1802–1806), verbatim.
  excerpt: [
    ["OP-01801", "2026-06-01", "North", "NO-01", "9080.66", "12017.52"],
    ["OP-01802", "2026-06-01", "North", "NO-02", "7934.55", "11304.61"],
    ["OP-01803", "2026-06-01", "North", "NO-03", "7052.94", "10286.18"],
    ["OP-01804", "2026-06-01", "North", "NO-04", "8992.49", "7943.78"],
    ["OP-01805", "2026-06-01", "North", "NO-05", "10403.08", "9878.81"],
    ["OP-01806", "2026-06-02", "North", "NO-01", "6700.29", "8045.62"],
  ],
};
