# fixtures/sample — canonical synthetic dataset

Fictional regional service operation (`regional-services-v1`, seed `260920`).
2,417 raw records → 2,400 retained; 29 quality issues (17 duplicates, 7 category
variants, 5 missing optional CSAT), 24 resolved / 5 disclosed-unresolved.
All values are synthetic; no company is represented.

| File | Contents |
|---|---|
| `sample_operations.csv` | Canonical raw CSV (header + 2,417 rows; includes the 17 appended duplicates). |
| `sample_operations.xlsx` | Bound workbook: `Operations` (source), `Dictionary`, `Calendar`. SHA-256 `f0d6d06e…3f5e`. |
| `sample_rows.json` | Raw rows as JSON (same content as the CSV). |
| `expected_clean.csv` | 2,400 retained rows after approved cleanup. |
| `expected_monthly.json` | 24 region×period aggregates (revenue, target, cost, orders, downtime). |
| `expected_quality.json` | 29-entry issue ledger with actions and one-based source rows. |
| `reporting_calendar.json` | 80 scheduled reporting days (20 per period, Mar–Jun 2026). |
| `sample_manifest.json` | `SampleManifest` v1.0.0: counts, grain, policies, CSV hashes. |
| `artifact_binding.json` | Byte hash (`sourceHash`) + semantic hash (`normalizationRevision`) binding. |

## Regeneration

```sh
python3 tooling/dataset/generate_sample.py     # canonical CSV/JSON (deterministic)
python3 tooling/dataset/verify_sample.py       # independent Decimal oracle
python3 tooling/dataset/bind_artifacts.py      # verify binding
```

XLSX bytes are not canonical — ZIP metadata varies by serializer. Regenerate a
candidate with `node tooling/dataset/write_sample_xlsx.mjs PATH`, then record it
with `bind_artifacts.py --candidate PATH` (pending status, not approval).

Truth anchors: North Jun revenue `881000` vs target `1000000` (−0.119); North
orders `10000→10800` (+0.08); North downtime `1194→1565` (+0.3107); Jun
all-region revenue `6000000`, cost `4500000`; +8% cost scenario → contribution
`1140000`, margin `0.19`. North evidence spans: May rows 1202–1301, June rows
1802–1901 (one-based, sheet `S0`). East anomaly: source row 2044, `EA-03`,
2026-06-11, 210 minutes.
