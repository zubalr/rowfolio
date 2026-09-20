/**
 * The checked-in schema registry. `rowfolio.schema.json` is the wire
 * authority; the per-definition wrapper documents exist so every contract
 * type is addressable by a stable $id. Resolution is entirely offline —
 * `.invalid` identifiers are names, not URLs (INTERFACES.md).
 */
import { createRegistry, SchemaValidator, type SchemaRegistry } from './validator.ts';
import { ContractError, type ContractIssue, type ValidationResult } from './errors.ts';

import rowfolioSchema from '../source/rowfolio.schema.json';
import analysisSnapshotSchema from '../source/analysis-snapshot.schema.json';
import exportModelSchema from '../source/export-model.schema.json';
import findingSchema from '../source/finding.schema.json';
import normalizedTableSchema from '../source/normalized-table.schema.json';
import provenanceSchema from '../source/provenance.schema.json';
import sampleManifestSchema from '../source/sample-manifest.schema.json';
import scenarioDefinitionSchema from '../source/scenario-definition.schema.json';
import scenarioResultSchema from '../source/scenario-result.schema.json';
import workerRequestSchema from '../source/worker-request.schema.json';
import workerResponseSchema from '../source/worker-response.schema.json';

export const CONTRACT_VERSION = '1.0.0' as const;
export const PROTOCOL_VERSION = 1 as const;
export const SCHEMA_ID = 'https://rowfolio.invalid/contracts/1.0.0/rowfolio.schema.json' as const;

export const SCHEMA_DOCUMENTS = {
  'rowfolio.schema.json': rowfolioSchema,
  'analysis-snapshot.schema.json': analysisSnapshotSchema,
  'export-model.schema.json': exportModelSchema,
  'finding.schema.json': findingSchema,
  'normalized-table.schema.json': normalizedTableSchema,
  'provenance.schema.json': provenanceSchema,
  'sample-manifest.schema.json': sampleManifestSchema,
  'scenario-definition.schema.json': scenarioDefinitionSchema,
  'scenario-result.schema.json': scenarioResultSchema,
  'worker-request.schema.json': workerRequestSchema,
  'worker-response.schema.json': workerResponseSchema,
} as const;

/** Authoritative schema document (the monolith containing all $defs). */
export const ROWFOLIO_SCHEMA = rowfolioSchema as Record<string, unknown>;

/** Every $defs contract type name, in schema order. */
export type ContractTypeName = keyof typeof ROWFOLIO_SCHEMA['$defs'];

export function schemaRegistry(): SchemaRegistry {
  return createRegistry([rowfolioSchema, ...Object.values(SCHEMA_DOCUMENTS)] as Record<string, unknown>[]);
}

function defSchema(name: string): Record<string, unknown> {
  const defs = (rowfolioSchema as { $defs: Record<string, Record<string, unknown>> }).$defs;
  const def = defs[name];
  if (def === undefined) throw new TypeError(`unknown contract type ${JSON.stringify(name)}`);
  return def;
}

/**
 * Structural validation of `value` against `$defs/${name}` of the wire
 * schema. Returns the deterministic issue list; empty means valid.
 * Semantic refinements live in `semantics.ts` — always run both.
 */
export function checkSchema(name: ContractTypeName | string, value: unknown): ContractIssue[] {
  const validator = new SchemaValidator(schemaRegistry(), rowfolioSchema as Record<string, unknown>);
  return validator.check(defSchema(name), value, '', `rowfolio.schema.json#/$defs/${name}`);
}

export function validateSchema<T>(name: ContractTypeName | string, value: unknown): ValidationResult<T> {
  const issues = checkSchema(name, value);
  return issues.length === 0 ? { ok: true, value: value as T, issues: [] } : { ok: false, issues };
}

export function assertSchema<T>(name: ContractTypeName | string, value: unknown): T {
  const issues = checkSchema(name, value);
  if (issues.length > 0) throw new ContractError(issues);
  return value as T;
}

/** True when `value` passes the structural schema for `name`. */
export function matchesSchema(name: ContractTypeName | string, value: unknown): boolean {
  return checkSchema(name, value).length === 0;
}
