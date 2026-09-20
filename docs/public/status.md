# Project status

Honest accounting of what exists in this repository today and what is still
in development. Last updated against the `hb/volume` branch bases; check the
commit history for anything newer.

## Present and verified

- **Contracts** (`packages/contracts/`): the versioned JSON Schemas for
  tables, analysis snapshots, findings, provenance, scenarios and exports;
  generated TypeScript types; policy values (numeric rules, input guardrails,
  finding thresholds); and the English/Arabic translation-key manifest
  (201 keys, typed placeholders, Arabic plural groups).
- **Sample data** (`fixtures/sample/`, `tooling/dataset/`): deterministic
  synthetic dataset with an independent exact-decimal verifier and golden
  bindings between artifacts and source hashes.
- **Hostile-input corpus** (`fixtures/hostile/generated/`,
  `tooling/test/corpus/`): bounded edge-case fixtures with per-case expected
  outcomes, an independent validator, and a driver proving regeneration is
  byte-identical and that mutations (changed values, missing rows, stale
  hashes, over-bound files) are detected.
- **Mechanical i18n checks** (`tests/unit/i18n/generated/`,
  `tooling/test/corpus/i18n/`): key/placeholder/plural expectations generated
  from the frozen manifest, plus catalog parity and mutation checks. Locale
  catalogs themselves have not landed yet; until they do, those tests report
  as explicitly pending.
- **Contract test suites** (`tests/contract/`): schema validation, decimal
  rules, envelope guards, oracle reconciliation.

Run everything with the commands in the [README](../../README.md#quick-start).

## In development

- Ingestion, normalization, analysis, provenance, scenario and export
  packages — being implemented against the contracts above.
- The web interface (English/Arabic), including upload review, findings,
  evidence and export dialogs.
- End-to-end, accessibility and performance suites.
- Office interoperability review of generated XLSX/PPTX in desktop
  Excel/PowerPoint and LibreOffice.

## Deliberately out of scope

Accounts, cloud storage, backend processing, analytics, AI/LLM integration,
formula evaluation, forecasts, automatic joins across sheets, and PDF export.
See [privacy.md](privacy.md) for what this means for your data and
[supported-formats.md](supported-formats.md) for format boundaries.
