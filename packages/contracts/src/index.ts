/**
 * @rowfolio/contracts — Rowfolio contract authority (v1.0.0).
 *
 * JSON Schema is the wire authority (`source/rowfolio.schema.json`); this
 * package ships the generated structural types, deterministic runtime
 * validators (structural + mandatory semantic refinements), exact-decimal
 * arithmetic for proof recomputation, worker transport envelopes and the
 * importable contract examples. No React, no arithmetic-library objects —
 * pure contract surface consumable by every package and both workers.
 */

// generated structural types
export * from './types.ts';

// version constants + schema registry
export {
  CONTRACT_VERSION,
  PROTOCOL_VERSION,
  SCHEMA_ID,
  SCHEMA_DOCUMENTS,
  ROWFOLIO_SCHEMA,
  schemaRegistry,
  checkSchema,
  validateSchema,
  assertSchema,
  matchesSchema,
} from './registry.ts';
export type { ContractTypeName } from './registry.ts';

// typed errors
export { ContractError, issue, pointer } from './errors.ts';
export type { ContractIssue, IssueCode, ValidationOk, ValidationFailed, ValidationResult } from './errors.ts';

// exact decimal module (canonical strings only — never ship library objects)
export {
  DECIMAL_PATTERN,
  DECIMAL_MAX_LENGTH,
  PRECISION,
  ROUNDING,
  DecimalArithmeticError,
  parseDecimal,
  isDecimal,
  isCanonicalDecimal,
  isIntegerDecimal,
  isZeroDecimal,
  isMultipleOfStep,
  significantDigits,
  withinSignificantDigitLimit,
  normalizeDecimalString,
  formatParts,
  compareDecimal,
  addDecimal,
  subtractDecimal,
  multiplyDecimal,
  divideDecimal,
} from './decimal.ts';
export type { DecimalParts } from './decimal.ts';

// canonical JSON + hashing
export { canonicalize, sha256Hex, isHash } from './canonical.ts';

// schema engine pieces (for tooling/tests)
export { SchemaValidator, createRegistry, isPlainObject, isValidDate, isValidDateTime, deepEqual } from './validator.ts';
export type { SchemaNode, SchemaRegistry } from './validator.ts';

// semantic refinements
export {
  checkNormalizedTable,
  checkAnalysisSnapshot,
  checkScenarioResult,
  checkExportModel,
  checkFinding,
  checkProvenance,
  checkScenarioDefinition,
  checkWorkerRequest,
  checkWorkerResponse,
  checkRawTable,
  checkSampleManifest,
  checkNormalizedRow,
  checkContract,
  validateContract,
  assertContract,
  assertNormalizedTable,
  assertAnalysisSnapshot,
  assertScenarioResult,
  assertExportModel,
  assertWorkerRequest,
  assertWorkerResponse,
  isSupportedCurrency,
} from './semantics.ts';
export type { SemanticContext, CheckableTypeName } from './semantics.ts';

// proof/expression evaluation (the deterministic contract oracle)
export { buildEvalContext, evaluateMetric, selectionRows } from './evaluate.ts';
export type { EvalContext, EvalOutcome } from './evaluate.ts';

// worker transport
export {
  checkWorkerEnvelope,
  packEnvelope,
  classifyWorkerResponse,
  createProgressChecker,
  checkContractVersion,
} from './envelopes.ts';
export type { BinarySlot, WorkerEnvelope, MessageContext, ResponseFreshness } from './envelopes.ts';

// policy + constant manifests
export { POLICY } from './policy.ts';
export type { RowfolioPolicy } from './policy.ts';
export { DESIGN_TOKENS } from './tokens.ts';
export { TRANSLATION_KEY_MANIFEST, isTranslationKey, translationKeys } from './keys.ts';

// importable contract examples
export {
  FINDING_EXAMPLE,
  PROVENANCE_EXAMPLE,
  SCENARIO_DEFINITION_EXAMPLE,
  WORKER_REQUEST_EXAMPLE,
  OPERATING_COST_SCENARIO_V1,
} from './examples.ts';
