/**
 * Immutable cost-sensitivity engine: one global operating-cost factor
 * applied to confirmed aggregates. Revenue, maintenance subset and source
 * cells are fixed; the factor is applied after aggregation, never with
 * per-row rounding. Invalid inputs throw typed errors (clamping is
 * forbidden); disabled data conditions yield an explicit `unavailable`
 * result instead of a fabricated number.
 */
import {
  addDecimal,
  compareDecimal,
  deepEqual,
  divideDecimal,
  isDecimal,
  isMultipleOfStep,
  multiplyDecimal,
  POLICY,
  PRECISION,
  ROUNDING,
  subtractDecimal,
} from '@rowfolio/contracts';
import type {
  AnalysisSnapshot,
  Decimal,
  Expression,
  Metric,
  Provenance,
  ScenarioDefinition,
  ScenarioResult,
  SourceRef,
  Unit,
} from '@rowfolio/contracts';

export class ScenarioError extends Error {
  readonly code:
    | 'unsupported-definition'
    | 'invalid-cost-change'
    | 'missing-metric'
    | 'undefined-metric';
  constructor(
    code: ScenarioError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ScenarioError';
    this.code = code;
  }
}

const DEFINITION_ID = 'operating-cost-v1';
const DEFINITION_VERSION = '1.0.0';
const TYPED_STEP = '0.001';
const RANGE_MIN = '-0.20';
const RANGE_MAX = '0.30';

const RATIO_UNIT: Unit = { kind: 'ratio', label: 'fraction', currency: null };
const PP_UNIT: Unit = { kind: 'percentage-point', label: 'pp', currency: null };

/** Half-up quantization to exactly `places` fraction digits (money display). */
export function quantizeMoney(value: Decimal, places: number): Decimal {
  const negative = value.startsWith('-');
  const body = negative ? value.slice(1) : value;
  const dot = body.indexOf('.');
  const int = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? '' : body.slice(dot + 1);
  if (places === 0) {
    const roundUp = (frac[0] ?? '0') >= '5';
    return `${negative && (int !== '0' || roundUp) ? '-' : ''}${roundUp ? (BigInt(int) + 1n).toString() : int}`;
  }
  if (frac.length <= places) {
    return `${negative ? '-' : ''}${int}.${frac.padEnd(places, '0')}`;
  }
  const keep = frac.slice(0, places);
  const dropped = frac.slice(places);
  const roundUp = (dropped[0] as string) >= '5';
  if (!roundUp) return `${negative ? '-' : ''}${int}.${keep}`;
  const bumped = (BigInt(int + keep) + 1n).toString().padStart(int.length + places, '0');
  const out = places === 0
    ? bumped
    : `${bumped.slice(0, bumped.length - places)}.${bumped.slice(bumped.length - places)}`;
  return `${negative ? '-' : ''}${out}`;
}

/** Fraction digits carried by a decimal literal (money display scale). */
export function fractionScale(value: Decimal): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

/** Deterministic scenario id: `scenario-<baselineId>-cost<digits>`. */
export function scenarioId(baselineAnalysisId: string, costChange: Decimal): string {
  const digits = costChange.replace('-', 'm').replace('.', '');
  return `scenario-${baselineAnalysisId}-cost${digits}`;
}

function assertDefinition(definition: ScenarioDefinition): void {
  if (
    definition.id !== DEFINITION_ID ||
    definition.version !== DEFINITION_VERSION ||
    definition.aggregationPolicy !== 'factor-after-aggregate' ||
    definition.requiresMetricIds.length !== 2
  ) {
    throw new ScenarioError(
      'unsupported-definition',
      `only ${DEFINITION_ID}@${DEFINITION_VERSION} with two required metrics is supported`,
    );
  }
}

function assertCostChange(costChange: Decimal, definition: ScenarioDefinition): void {
  if (!isDecimal(costChange)) {
    throw new ScenarioError('invalid-cost-change', 'costChange must be a finite canonical decimal fraction');
  }
  const min = definition.parameter.min;
  const max = definition.parameter.max;
  if (compareDecimal(costChange, min) < 0 || compareDecimal(costChange, max) > 0) {
    throw new ScenarioError(
      'invalid-cost-change',
      `costChange ${costChange} is outside [${min}, ${max}] — clamping is forbidden`,
    );
  }
  if (!isMultipleOfStep(costChange, TYPED_STEP)) {
    throw new ScenarioError(
      'invalid-cost-change',
      `costChange ${costChange} is not an exact multiple of the typed step ${TYPED_STEP}`,
    );
  }
}

interface Baseline {
  readonly revenue: Metric;
  readonly cost: Metric;
}

function requireBaseline(snapshotMetrics: readonly Metric[], definition: ScenarioDefinition): Baseline {
  const [revenueId, costId] = definition.requiresMetricIds as [string, string];
  const revenue = snapshotMetrics.find((m) => m.id === revenueId);
  const cost = snapshotMetrics.find((m) => m.id === costId);
  if (revenue === undefined || cost === undefined) {
    throw new ScenarioError('missing-metric', 'baseline snapshot lacks a required scenario metric');
  }
  if (revenue.status !== 'defined' || revenue.value === null) {
    throw new ScenarioError('undefined-metric', `required baseline metric ${JSON.stringify(revenueId)} is not defined`);
  }
  if (cost.status !== 'defined' || cost.value === null) {
    throw new ScenarioError('undefined-metric', `required baseline metric ${JSON.stringify(costId)} is not defined`);
  }
  return { revenue, cost };
}

function makeProof(
  id: string,
  expression: Expression,
  result: Decimal,
  sourceRefs: SourceRef[],
  normalizationRevision: string,
): Provenance {
  return {
    id,
    sourceRefs,
    selections: [],
    expression,
    result,
    status: 'defined',
    reasonKey: null,
    policyVersion: POLICY.version,
    normalizationRevision,
    transformIds: [],
    precision: PRECISION,
    rounding: ROUNDING,
  };
}

function makeMetric(
  id: string,
  labelKey: string,
  value: Decimal,
  unit: Unit,
  scopeOf: Metric,
  provenanceId: string,
): Metric {
  return {
    id,
    labelKey,
    value,
    status: 'defined',
    reasonKey: null,
    unit,
    scope: { ...scopeOf.scope },
    eligibleRows: scopeOf.eligibleRows,
    totalRows: scopeOf.totalRows,
    provenanceId,
    warnings: [...new Set([...scopeOf.warnings])],
  };
}

export function runScenario(
  snapshot: AnalysisSnapshot,
  definition: ScenarioDefinition,
  costChange: Decimal,
): ScenarioResult {
  assertDefinition(definition);
  assertCostChange(costChange, definition);
  const { revenue, cost } = requireBaseline(snapshot.metrics, definition);

  const revenueValue = revenue.value as Decimal;
  const costValue = cost.value as Decimal;

  if (compareDecimal(revenueValue, '0') <= 0) {
    return unavailable(snapshot, definition, costChange, 'scenario.zeroRevenue');
  }
  if (compareDecimal(costValue, '0') < 0) {
    return unavailable(snapshot, definition, costChange, 'scenario.negativeCost');
  }
  if (revenue.unit.kind === 'currency' && cost.unit.kind === 'currency'
    && revenue.unit.currency !== cost.unit.currency) {
    return unavailable(snapshot, definition, costChange, 'scenario.unavailable');
  }

  const revenueProof = snapshot.provenance.find((p) => p.id === revenue.provenanceId);
  const costProof = snapshot.provenance.find((p) => p.id === cost.provenanceId);
  const baseRefs: SourceRef[] = [
    ...new Map(
      [...(revenueProof?.sourceRefs ?? []), ...(costProof?.sourceRefs ?? [])].map((r) => [r.id, r] as const),
    ).values(),
  ];

  const moneyScale = Math.max(fractionScale(revenueValue), fractionScale(costValue));
  const factor = addDecimal('1', costChange);

  const costExact = multiplyDecimal(costValue, factor);
  const scenarioCost = quantizeMoney(costExact, moneyScale);
  const contributionExact = subtractDecimal(revenueValue, scenarioCost);
  const scenarioContribution = quantizeMoney(contributionExact, moneyScale);
  const scenarioMargin = divideDecimal(scenarioContribution, revenueValue);
  // The delta leg needs a defined baseline margin in the snapshot scope.
  // Generic snapshots may not have one; omitting the delta is explicit,
  // inventing a baseline would fabricate the comparison.
  const baselineMarginId = baselineMarginMetricId(snapshot);

  const costProofId = 'scenario-cost-proof';
  const contributionProofId = 'scenario-contribution-proof';
  const marginProofId = 'scenario-margin-proof';
  const deltaProofId = 'scenario-margin-delta-pp-proof';

  const proofs: Provenance[] = [
    makeProof(costProofId, {
      op: 'multiply',
      left: { op: 'metric', metricId: cost.id },
      right: { op: 'add', left: { op: 'literal', value: '1' }, right: { op: 'literal', value: costChange } },
    }, scenarioCost, baseRefs, snapshot.normalizationRevision),
    makeProof(contributionProofId, {
      op: 'subtract',
      left: { op: 'metric', metricId: revenue.id },
      right: { op: 'metric', metricId: 'scenario-cost' },
    }, scenarioContribution, baseRefs, snapshot.normalizationRevision),
    makeProof(marginProofId, {
      op: 'divide',
      left: { op: 'metric', metricId: 'scenario-contribution' },
      right: { op: 'metric', metricId: revenue.id },
    }, scenarioMargin, baseRefs, snapshot.normalizationRevision),
  ];

  const metrics: Metric[] = [
    makeMetric('scenario-cost', 'metric.operating_cost', scenarioCost, { ...cost.unit }, cost, costProofId),
    makeMetric('scenario-contribution', 'metric.contribution', scenarioContribution, { ...revenue.unit }, revenue, contributionProofId),
    makeMetric('scenario-margin', 'metric.margin', scenarioMargin, RATIO_UNIT, revenue, marginProofId),
  ];

  if (baselineMarginId !== null) {
    const baselineMargin = divideDecimal(subtractDecimal(revenueValue, costValue), revenueValue);
    const marginDelta = multiplyDecimal(subtractDecimal(scenarioMargin, baselineMargin), '100');
    proofs.push(makeProof(deltaProofId, {
      op: 'multiply',
      left: {
        op: 'subtract',
        left: { op: 'metric', metricId: 'scenario-margin' },
        right: { op: 'metric', metricId: baselineMarginId },
      },
      right: { op: 'literal', value: '100' },
    }, marginDelta, baseRefs, snapshot.normalizationRevision));
    metrics.push(makeMetric('scenario-margin-delta-pp', 'metric.marginDelta', marginDelta, PP_UNIT, revenue, deltaProofId));
  }

  return {
    id: scenarioId(snapshot.id, costChange),
    definitionId: definition.id,
    baselineAnalysisId: snapshot.id,
    costChange,
    scope: { ...snapshot.scope },
    metrics,
    provenance: proofs,
    status: 'defined',
    reasonKey: null,
  };
}

/** Baseline margin metric for the delta proof, if the snapshot defines one. */
function baselineMarginMetricId(snapshot: AnalysisSnapshot): string | null {
  const direct = snapshot.metrics.find((m) =>
    m.status === 'defined' && m.unit.kind === 'ratio' && deepEqual(m.scope, snapshot.scope),
  );
  return direct?.id ?? null;
}

function unavailable(
  snapshot: AnalysisSnapshot,
  definition: ScenarioDefinition,
  costChange: Decimal,
  reasonKey: string,
): ScenarioResult {
  void definition;
  return {
    id: scenarioId(snapshot.id, costChange),
    definitionId: DEFINITION_ID,
    baselineAnalysisId: snapshot.id,
    costChange,
    scope: { ...snapshot.scope },
    metrics: [],
    provenance: [],
    status: 'unavailable',
    reasonKey,
  };
}

export { RANGE_MAX, RANGE_MIN };
