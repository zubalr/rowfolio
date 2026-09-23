# Synthetic data

Everything that looks like business data in this repository is synthetic.
No real company, person, transaction or account is represented, and no real
dataset was used as a source. Invented generic entities (regions, stores,
products, identifiers) are used throughout.

## The sample dataset

`fixtures/sample/` holds a fictional regional service operation: 2,417 raw
observations covering four reporting periods in 2026, six invented regions
and thirty sites, with deliberately embedded patterns (a target shortfall, a
month-over-month cost increase, duplicate rows and category variants for the
quality ledger). It is generated deterministically by
`tooling/dataset/generate_sample.py` from a fixed seed, and an independent
Python verifier (`tooling/dataset/verify_sample.py`) recomputes the expected
aggregates with exact decimal arithmetic from the CSV — the generator and the
verifier are separate implementations, and neither is the production engine.

The dataset ships with the application as a one-click demo (the files under
`apps/web/public/sample/`) so visitors can explore a full briefing without
uploading anything. Because it is synthetic, it demonstrates the product's
mechanics; it does not describe any real organization's performance.

## The hostile-input corpus

`fixtures/hostile/generated/` contains bounded synthetic edge cases used to
test spreadsheet ingestion: unusual quoting and line endings, duplicate or
blank headers, ragged records, missing or invalid values, ambiguous dates and
number formats, Unicode/RTL text, formula-looking strings, and minimal OOXML
structural variants. Each case ships with a manifest stating its expected
semantic outcome and SHA-256.

Safety rules for this corpus, enforced by its generator and validator:

- total size under 20 MB, each CSV under 5,000 data rows;
- each OOXML package under 1 MB expanded and 100 entries;
- no zip bombs, no resource-exhaustion payloads;
- formula-looking cells are inert text in flat data files.

## Determinism

Generators use fixed seeds and no clocks, so regeneration reproduces the same
bytes; the verification driver (`tooling/test/corpus/run_corpus_checks.py`)
regenerates the corpus twice and compares hashes, and demonstrates that
changed values, deleted rows and stale hashes are detected. When a fixture
changes on purpose, it is regenerated with the documented command and the
difference is explained in the change that commits it.
