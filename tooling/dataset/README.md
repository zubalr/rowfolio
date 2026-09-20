# tooling/dataset — synthetic sample and truth tooling

Deterministic, standard-library-only tooling for the bundled fictional dataset
(`regional-services-v1`, seed `260920`). No runtime service code lives here.

## Files

| File | Purpose |
|---|---|
| `generate_sample.py` | Rebuilds canonical CSV/JSON fixtures into `fixtures/sample/` (seed 260920, largest-remainder allocator). |
| `verify_sample.py` | Independent Decimal oracle. Reads CSV only; does not import the generator or trust aggregate fixtures. |
| `bind_artifacts.py` | Byte hash binding, kept separate from semantic hash. Fails closed on drift; `--candidate` records a pending binding. |
| `export_golden.py` | Writes `fixtures/golden/` truth files derived only from oracle output. |
| `write_sample_xlsx.mjs` | ExcelJS wrapper producing Operations/Dictionary/Calendar sheets. Requires `npm --prefix tooling/dataset install`. Tooling only — not the production parser. |
| `build_sample_snapshot.mjs` | Builds `apps/web/public/sample/prepared.snapshot.json` strictly through the merged production ingest/normalize/analysis adapters. Refuses to run without them. |
| `tests/test_dataset.py` | unittest suite: determinism, oracle, XML cell comparison, spans, ledger. |

## Commands (from repo root)

```sh
python3 tooling/dataset/generate_sample.py            # regenerate fixtures/sample
python3 tooling/dataset/verify_sample.py              # oracle assertions
python3 tooling/dataset/bind_artifacts.py             # verify byte + semantic binding
python3 tooling/dataset/export_golden.py              # refresh fixtures/golden
python3 -m unittest discover -s tooling/dataset/tests # full local suite
node tooling/dataset/write_sample_xlsx.mjs /tmp/x.xlsx # candidate workbook (needs exceljs)
node tooling/dataset/build_sample_snapshot.mjs --ingest <mod> --normalize <mod> --analysis <mod>
```

## Identity model

- `sourceHash` — SHA-256 of the XLSX bytes; binds demos to the real file.
- `sourceCsvSha256` / `cleanCsvSha256` — SHA-256 of canonical CSV text.
- `normalizationRevision` — SHA-256 of the canonical payload (policy + column
  order + clean rows + approved issue IDs). Semantic identity, independent of
  ZIP/container bytes.

Regenerating the workbook with a different serializer changes ZIP bytes even
when cells are identical; rebind via `bind_artifacts.py --candidate` and rebuild
the snapshot through the production pipeline before shipping.

## Dependencies

Python 3.11+ stdlib for all `*.py` tools and tests. `write_sample_xlsx.mjs` and
`build_sample_snapshot.mjs` need Node; the XLSX writer needs `exceljs@4.4.0`
(declared in `package.json`; root workspace wiring is owned elsewhere).
