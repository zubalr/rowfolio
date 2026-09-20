# Corpus tooling

Generators and validators for bounded deterministic test corpora. No
dependencies beyond the Python 3 standard library.

## Hostile-input corpus

`generate_hostile_corpus.py` writes `fixtures/hostile/generated/` (CSV and
minimal OOXML edge cases with per-case manifests declaring an independent
expected semantic outcome and SHA-256). `validate_hostile_corpus.py` is an
independent integrity/bounds checker; `--structural` adds a light
second-implementation read (csv / zipfile / ElementTree) of the coarse shape
facts declared in each manifest.

### Generated layout

- `<case-id>.csv` / `<case-id>.xlsx` — the artifact
- `<case-id>.manifest.json` — hash, size, media type and the independently
  authored expected semantic outcome (the contract a parser is tested
  against; production code is never its own oracle)
- `corpus-index.json` — case list, bounds, totals

Bounds, enforced by generator and validator alike: total corpus < 20 MB,
each CSV < 5,000 data rows, each OOXML package < 1 MB expanded with < 100
entries, no cell text at or above 32,000 characters. The corpus is safe by
construction: inert data files, no zip bombs, no resource-exhaustion
payloads, invented entities only.

### Inventory coupling

`fixtures/hostile/manifest.json` — the verification lane's inventory —
enumerates every file allowed under `fixtures/hostile/`, including this
subtree, and a repository hygiene test fails on any undeclared file. When a
corpus case is added or removed here, the inventory must be updated by its
owner in the same change.

### Consuming a case

Read `<case-id>.manifest.json` → `expected`. The `tableShape` block states
the coarse shape; `requiredBehavior` states the interpretation rules an
ingest implementation must follow (for example: blank cells are missing, not
zero; duplicate headers get ordinal IDs; slash dates stay ambiguous until
confirmed; formula-looking strings stay inert text). Tests for an ingestion
engine assert its parse result against these declarations.

### Commands

```sh
# full verification: committed corpus, repeatability, mutation detection
python3 tooling/test/corpus/run_corpus_checks.py

# regenerate after changing a case definition
python3 tooling/test/corpus/generate_hostile_corpus.py

# integrity + bounds only / with structural cross-checks
python3 tooling/test/corpus/validate_hostile_corpus.py
python3 tooling/test/corpus/validate_hostile_corpus.py --structural
```

The driver writes nothing inside the repository; pass `--report PATH` to store
the JSON summary at a private (never committed) location.

## i18n catalog checks

`i18n/generate-expectations.ts` reads the frozen translation-key manifest at
`packages/contracts/source/translation-keys.json` and emits
`tests/unit/i18n/generated/manifest-expectations.gen.ts` (key list, typed
placeholder sets, plural groups, manifest hash).

```sh
node tooling/test/corpus/i18n/generate-expectations.ts
node tooling/test/corpus/i18n/check-catalog.ts              # manual run, prints JSON
node tooling/test/corpus/i18n/check-catalog.ts --dir <catalog-dir>
```

The generated Vitest suite in `tests/unit/i18n/generated/` verifies the
expectations against the live manifest and, once locale catalogs exist, key
parity, placeholder parity and Arabic plural-form coverage — including
mutation checks proving a missing key, a mismatched placeholder and an
incomplete plural group are each detected. Catalog locations are resolved in
this order: `$ROWFOLIO_I18N_CATALOG_DIR`, then
`packages/i18n/catalogs/`, `packages/i18n/src/catalogs/`,
`packages/i18n/src/locales/`, `packages/contracts/source/locales/`. Until a
catalog is found, those tests report as explicitly pending rather than
passing vacuously.
