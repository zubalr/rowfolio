# Schema-change procedure

`source/rowfolio.schema.json` is the wire authority for every cross-package payload in Rowfolio. v1.0.0 is frozen once the maintainer marks it final; until then all changes route through this procedure.

## When a change is needed

1. **Propose, don't merge.** Open a PR or issue describing the exact `$defs` edit and the semantic motivation — e.g. a new `Expression` op, a new metric kind, a renamed field. Contract changes are never piggybacked on feature work.
2. **Maintainer review.** The maintainer arbitrates compatibility: additive optional fields may be patch-level; anything that changes required keys, enum/const values, `additionalProperties` strictness or semantic invariants is **breaking**.
3. **Version bump.** Breaking changes produce a new contract version (`rowfolio.schema.json` `title`, the `$id` path segment, `CONTRACT_VERSION`, `SCHEMA_DOCUMENTS` filenames, `packages/contracts/package.json#version`, and `policy.json#version` when policy semantics change). Patch-level documentation fixes keep the version.
4. **Regenerate types.** `pnpm --filter @rowfolio/contracts generate:types` must leave `src/types.ts` byte-identical to the committed file — the contract test fails on any drift.
5. **Migration fixtures.** A version bump ships: (a) new positive examples under `source/examples/` and `tests/contract/fixtures/`, (b) a negative fixture proving the *old* version is rejected by the new schema, and (c) a `validation/` note mapping old payloads to new. `normalizationRevision`/`analysisId`/`scenarioId`/`exportId` semantics are re-bound when the hash domain changes.
6. **Coordinated downstream update.** Every package that consumes a changed type re-runs its contract tests against the new version before merge. Schema and implementation land in separate PRs: contract first, consumers second.
7. **Freeze.** Once a version is marked final, further changes go through the same procedure as the next version — never an in-place edit to a frozen version.

## What validators guarantee

- **Structural** (`checkSchema`, `checkContract`): draft 2020-12 subset — type, enum, const, `oneOf`/`anyOf`/`allOf`, `properties`/`required`/`additionalProperties`, `items`/`minItems`/`maxItems`, `minLength`/`maxLength`, `pattern`, `minimum`/`maximum`, `format: date-time`, `$ref`/`$defs` resolution against the checked-in registry. Unknown keys are rejected where the schema says `additionalProperties: false`.
- **Semantic** (`check*` functions): referential integrity, canonical spans, status triples, decimal safety (no NaN/Infinity/exponent/negative-zero, ≤30 input significant digits), real dates, source-hash/revision consistency, scenario bounds, quality-ledger reconciliation, key-manifest coverage, and proof-DAG recomputation (`evaluateMetric`).
- **Version guards**: `schemaVersion`, `policyVersion`, `protocolVersion` mismatches are typed `version` issues — stale payloads are rejected, not coerced.

## Reviewer checklist for a schema PR

- [ ] Diff touches only `packages/contracts/` (+ `tests/contract/` fixtures).
- [ ] `generate-types.mjs` output committed, `check:generated` green.
- [ ] Every removed/renamed field has a documented migration path.
- [ ] New positive + negative fixtures committed; fixture hashes in PR body.
- [ ] Downstream packages that consume the changed type are listed.
