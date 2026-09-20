# public/sample — bundled demo source assets

Static assets served with the app for the guided demo. All synthetic
(`regional-services-v1`); no real data is bundled.

- `sample_operations.xlsx` — bound demo workbook (SHA-256
  `f0d6d06e934b1eef01d839d071ec7dcdc6d9d47b58ccf556c4eb44f92adb3f5e`).
- `manifest.json` — `SampleManifest` v1.0.0 for this dataset.
- `index.json` — asset index with hashes; records `preparedSnapshot` as
  `pending-production-engine` until the real snapshot is built by
  `tooling/dataset/build_sample_snapshot.mjs`.

Do not commit a hand-authored `prepared.snapshot.json`. It is generated only
through the merged production ingest → normalize → analysis adapters.
