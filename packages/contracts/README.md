# @rowfolio/contracts

Rowfolio's **sole wire-schema authority** (contract version **1.0.0**). Every package validates boundary payloads against these contracts; no package invents a second `Finding`/`Metric`/`NormalizedTable`.

- **Wire authority:** `source/rowfolio.schema.json` (JSON Schema draft 2020-12, monolith `$defs`) plus the per-definition wrapper documents (`source/*.schema.json`) giving each contract type a stable `$id`.
- **Normative semantics:** `source/INTERFACES.md` — semantic refinements, worker transport rules, identity/canonicalization and the localization contract. It is binding, not descriptive.
- **Policy + manifests:** `source/policy.json` (numeric/limits/thresholds), `source/design-tokens.json`, `source/translation-keys.json` (key inventory; locale catalogs live in `packages/i18n`).
- **Generated types:** `src/types.ts` — regenerate with `pnpm --filter @rowfolio/contracts generate:types`; never edit by hand.
- **Examples:** `source/examples/*.example.json` — importable via `@rowfolio/contracts/examples`.

## Public API

| Area | Exports |
|---|---|
| Structural validation | `checkSchema` / `validateSchema` / `assertSchema` / `matchesSchema` — deterministic `ContractIssue[]`, offline registry, typed `ContractError` |
| Semantic refinements | `checkNormalizedTable`, `checkAnalysisSnapshot`, `checkScenarioResult`, `checkExportModel`, `checkWorkerRequest/Response`, `checkFinding`, `checkProvenance`, `checkScenarioDefinition`, `checkRawTable`, `checkSampleManifest`, `checkNormalizedRow`, generic `checkContract`/`validateContract`/`assertContract` |
| Contract oracle | `buildEvalContext` + `evaluateMetric` — recompute every defined metric through its provenance graph at precision 40 `ROUND_HALF_UP` |
| Exact decimals | `addDecimal`/`subtractDecimal`/`multiplyDecimal`/`divideDecimal`, `compareDecimal`, `isDecimal`, `normalizeDecimalString`, `significantDigits` — canonical strings only; library objects never cross package boundaries |
| Identity | `canonicalize` (sorted-key, whitespace-free canonical JSON), `sha256Hex` (WebCrypto) |
| Worker transport | `checkWorkerEnvelope`, `packEnvelope`, `classifyWorkerResponse` (stale guard), `createProgressChecker` (per-stage monotonicity) |
| Constants | `CONTRACT_VERSION`, `PROTOCOL_VERSION`, `POLICY`, `DESIGN_TOKENS`, `TRANSLATION_KEY_MANIFEST`, `SCHEMA_DOCUMENTS` |
| Examples | `FINDING_EXAMPLE`, `PROVENANCE_EXAMPLE`, `SCENARIO_DEFINITION_EXAMPLE`, `WORKER_REQUEST_EXAMPLE`, `OPERATING_COST_SCENARIO_V1` |
| Signatures | `import '@rowfolio/contracts/interfaces'` — the package entry-point types from INTERFACES.md |

## Hard invariants enforced here

- `*Key` fields resolve against the translation-key manifest; row IDs bind `{sheetId}:R{physicalRow}`; cell values satisfy column type/nullability and the 30-significant-digit input ceiling; calendar dates are real Gregorian dates.
- Row selections are canonical spans (sorted, disjoint, non-adjacent); excluded IDs never contribute; `transformIds` resolve to `resolved` ledger issues.
- `defined` ⇔ finite decimal + `null` reason; `undefined` ⇔ `null` value + reason key. A defined metric whose proof graph hits a zero denominator or an undefined operand is a contract violation, not a quiet clamp.
- `policyVersion` equals `POLICY.version`; `protocolVersion` is `1`; scenario `costChange` stays within `[-0.20, 0.30]` as an exact `0.001` multiple — never silently clamped.
- Binary payloads travel in declared `binaries` slots with exact `byteLength`; nothing binary is serialized into JSON.

## Schema-change procedure

See [`SCHEMA_CHANGES.md`](./SCHEMA_CHANGES.md). Short version: schema edits require L00 approval, a version bump, regenerated types, migration fixtures and coordinated downstream updates. v1 freezes after lead review.

## Boundary

No React, no arithmetic-library dependencies, no I/O. Consumed by every package; consumed *by* nothing outside the workspace.
