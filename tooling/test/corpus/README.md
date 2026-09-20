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
`packages/contracts/source/locales/`. Until a catalog lands, those tests
report as explicitly pending rather than passing vacuously.
