# Project status

Honest accounting of what exists in this repository today and what is still
outstanding. Check the commit history for anything newer.

## Present and verified

- **Contracts** (`packages/contracts/`): the versioned JSON Schemas for
  tables, analysis snapshots, findings, provenance, scenarios and exports;
  generated TypeScript types; policy values (numeric rules, input guardrails,
  finding thresholds); and the English/Arabic translation-key manifest
  (201 keys, typed placeholders, Arabic plural groups).
- **Deterministic engines** (`packages/normalize/`, `packages/analysis/`,
  `packages/provenance/`, `packages/scenario/`, `packages/export-model/`):
  normalization with explicit approvals, metrics and rule-based findings,
  source-row provenance, the cost scenario, and the briefing model — covered
  by unit suites, golden-snapshot parity and property tests.
- **Bounded ingestion** (`packages/ingest/`): CSV and XLSX readers with
  contract-policy limits, date/number profile handling and a parse watchdog,
  exercised by the hostile fixtures and unit tests.
- **Native export writers** (`packages/export-xlsx/`,
  `packages/export-pptx/`): workbook and presentation generation from the
  briefing model, with integration suites and visual baselines.
- **Language system** (`packages/i18n/`): English/Arabic catalogs, typed
  placeholder interpolation, Arabic plural rules, formatting and directional
  isolation; mechanical catalog checks in `tests/unit/i18n/generated/`.
- **Interface** (`apps/web/`): bilingual landing with a guided demo and lazy
  preview, conservative upload review, workspace with findings, charts, and
  the evidence dialog with an exact source-rows browser.
- **Verification** (`tests/`, `tooling/`): unit, contract, integration, e2e,
  accessibility, performance, privacy and visual suites; the deterministic
  sample dataset with an independent Decimal verifier; the hostile-input
  corpus with an independent validator; capture tooling for
  release-candidate media.

Run everything with the commands in the [README](../../README.md#quick-start).

## Outstanding before release

- Final release gates: full journey coverage in the mounted app,
  accessibility and performance runs on the declared devices, deployed-site
  privacy checks against the shipped candidate.
- Office and LibreOffice interoperability review of generated XLSX/PPTX with
  recorded versions and renders (native Arabic review included).
- Deployment of the static build and post-deploy verification.

## Deliberately out of scope

Accounts, cloud storage, backend processing, analytics, AI/LLM integration,
formula evaluation, forecasts, automatic joins across sheets, and PDF export.
See [privacy.md](privacy.md) for what this means for your data and
[supported-formats.md](supported-formats.md) for format boundaries.
