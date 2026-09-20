# Hostile-input fixture corpus (generated)

Bounded, deterministic, synthetic fixtures that stress spreadsheet ingestion:
RFC 4180 quoting, BOM, embedded newlines, duplicate/empty headers, ragged
records, missing/invalid/zero values, slash-date and numeric-separator
ambiguity, leading-zero identifiers, formula-looking text cells, Unicode
RTL/normalization cases, and minimal OOXML structural edge cases.

Everything here is safe by construction: inert data files only, no zip bombs,
no resource-exhaustion payloads, no real personal or business data. All
entities are invented.

## Layout

- `<case-id>.csv` / `<case-id>.xlsx` — the artifact
- `<case-id>.manifest.json` — hash, size, media type and the independently
  authored **expected semantic outcome** for the case (the contract a parser
  is tested against; production code is never its own oracle)
- `corpus-index.json` — case list, bounds, totals

## Bounds (enforced by generator and validator)

| Bound | Value |
| --- | --- |
| Total corpus size | < 20 MB (actual: ~18 KB) |
| Rows per CSV | < 5,000 |
| OOXML expanded size | < 1 MB per package |
| OOXML entries | < 100 per package |
| Cell text | < 32,000 characters |

## Regenerate and verify

```sh
python3 tooling/test/corpus/generate_hostile_corpus.py
python3 tooling/test/corpus/validate_hostile_corpus.py --structural
python3 tooling/test/corpus/run_corpus_checks.py
```

`run_corpus_checks.py` proves byte-level repeatability (two independent
generations plus comparison against the committed corpus) and demonstrates
that changed values, deleted rows (CSV and OOXML), stale manifest hashes and
over-bound files are all detected. Artifacts are committed alongside the
generator; regeneration is expected to be byte-identical (OOXML entries are
stored uncompressed with fixed timestamps on purpose so package bytes do not
depend on the zlib build).

## Consuming a case

Read `<case-id>.manifest.json` → `expected`. The `tableShape` block states the
coarse shape; `requiredBehavior` states the interpretation rules an ingest
implementation must follow (for example: blank cells are missing, not zero;
duplicate headers get ordinal IDs; slash dates stay ambiguous until confirmed;
formula-looking strings stay inert text). Tests for an ingestion engine assert
its parse result against these declarations.
