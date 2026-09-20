# Rowfolio

Rowfolio is a browser-based spreadsheet briefing tool designed to connect every
finding to its source data. The planned workflow covers data review and
cleanup, deterministic analysis, source-row evidence, cost scenarios, and
editable Excel and PowerPoint exports, with complete English and Arabic
interfaces. All processing runs locally in the browser: no account, no upload
of spreadsheet contents, no server-side analysis.

> **Status: under development.** This repository currently contains the
> versioned contracts, sample and adversarial test fixtures, verification
> tooling, and contract test suites described below. The application packages
> (ingestion, analysis, exports, interface) are being implemented against
> those contracts and are not ready for use.

## Requirements

- Node.js ≥ 22.12
- pnpm 12 (Corepack: `corepack enable`)

## Quick start

```sh
pnpm install --frozen-lockfile
pnpm test          # unit and contract suites (Vitest)
pnpm typecheck     # TypeScript project checks
pnpm lint          # ESLint
pnpm build         # web build
```

### Fixture and corpus tooling

```sh
# regenerate and verify the bounded hostile-input corpus
python3 tooling/test/corpus/generate_hostile_corpus.py
python3 tooling/test/corpus/validate_hostile_corpus.py --structural
python3 tooling/test/corpus/run_corpus_checks.py

# regenerate the i18n catalog expectations from the frozen key manifest
node tooling/test/corpus/i18n/generate-expectations.ts
```

The corpus scripts need only the Python 3 standard library. See
`tooling/test/corpus/README.md` for what each command verifies.

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/web/` | Web application shell (in development) |
| `packages/contracts/` | Sole wire-schema authority: JSON Schemas, generated TypeScript, policy, translation-key manifest |
| `packages/*` | Ingestion, normalization, analysis, provenance, scenario, export, UI, i18n and chart packages (in development) |
| `fixtures/sample/` | Deterministic synthetic sample dataset, independent expected aggregates, quality ledger |
| `fixtures/hostile/generated/` | Bounded synthetic edge-case corpus with per-case expected outcomes and hashes |
| `fixtures/golden/` | Independent oracle outputs binding artifacts to source hashes |
| `tests/` | Contract suites; `unit/`, `integration/`, `e2e/` fill in as packages land |
| `tooling/dataset/` | Sample generator, independent Decimal verifier, artifact binder |
| `tooling/test/corpus/` | Hostile-corpus generator/validator and i18n catalog checkers |
| `tooling/capture/` | Screenshot capture tooling for release-candidate media (private outputs) |
| `docs/public/` | Product documentation: formats and limits, privacy, synthetic data, status |

## Supported input formats

The specified input envelope for spreadsheet ingestion is UTF-8 CSV and
unencrypted `.xlsx`, with guardrails of 10 MiB compressed file size, 50,000
rows including header, 100 columns, 500,000 non-empty cells and 20 visible
sheets per workbook. Ingestion enforces these bounds when implemented; see
[docs/public/supported-formats.md](docs/public/supported-formats.md) for
details and current implementation status.

## Privacy

The product specification is that spreadsheet contents are processed in the
browser and never uploaded: no analytics, no error-reporting services, no
accounts, and nothing about an analysis session persisted beyond it. Details
and boundaries: [docs/public/privacy.md](docs/public/privacy.md).

## Synthetic data

All sample and test data in this repository is synthetic and generated
deterministically; no real company or personal data is represented. See
[docs/public/synthetic-data.md](docs/public/synthetic-data.md).

## License

[MIT](LICENSE). Third-party library notices are collected in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
