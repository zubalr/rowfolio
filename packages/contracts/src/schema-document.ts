/**
 * Access to the raw schema documents for tooling (codegen checkers, docs,
 * downstream type generation). Prefer the compiled validators in
 * `registry.ts` for validation — these are the source artifacts themselves.
 */
import { ROWFOLIO_SCHEMA, SCHEMA_DOCUMENTS } from './registry.ts';

export { ROWFOLIO_SCHEMA, SCHEMA_DOCUMENTS };

/** Every $defs contract type name declared by the wire schema, in order. */
export function contractTypeNames(): string[] {
  return Object.keys((ROWFOLIO_SCHEMA as { $defs: Record<string, unknown> }).$defs);
}

/** The $defs subschema for a contract type name, or undefined. */
export function schemaDef(name: string): Record<string, unknown> | undefined {
  return (ROWFOLIO_SCHEMA as { $defs: Record<string, Record<string, unknown>> }).$defs[name];
}
