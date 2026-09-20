# A22 attack corpus inventory

All payloads are synthetic and deterministic — nothing private, nothing fetched.
Three fixture channels, all exercised by `tests/adversarial/`:

## 1. Checked-in hostile corpus — `fixtures/hostile/generated/` (23 cases)

Authoritative index: `fixtures/hostile/generated/corpus-index.json` (sha256 + bytes per case).
Each case ships a `*.manifest.json` declaring the expected behavior.

## 2. Checked-in ingest corpus — `fixtures/ingest/generated/`

Used by `ingest-corpus.test.ts`:

| file | sha256 | attack |
|---|---|---|
| `declared-lie.xlsx` | `1edc5334…0eb988d51` | declared size/dimension lie → typed LIMIT_EXCEEDED (entry >32MiB inflated) |
| `many-rows.xlsx` | `f5f90762…8f3133` | large-row worksheet at envelope |
| `encrypted-entries.xlsx` | `0490ac9b…a2849dd` | forged encryption flags → UNSUPPORTED |
| `ods-masquerade.xlsx` | `9218040d…d90999e2` | ODS mimetype in .xlsx → UNSUPPORTED |
| `ole2-xls.xlsx` | `3d33ec90…ae577` | OLE2 compound renamed .xlsx → UNSUPPORTED |
| `macro-xlsm.xlsx` | `c6f42e60…26aa476` | vbaProject + macroEnabled types → UNSUPPORTED |
| `invalid-utf8.csv` | `a3795358…b990e5b` | non-UTF-8 bytes → INVALID_FILE |
| `external-refs.xlsx`, `path-traversal.xlsx`, `dup-entry.xlsx`, `too-many-entries.xlsx`, `garbage-pk.xlsx`, `malformed-xml.xlsx`, `not-a-workbook.xlsx`, `bomb.xlsx` | (in manifest.json) | per-name attacks, all typed refusals |

## 3. Synthesized in-test via the checked-in kits

`fixtures/ingest/zipkit.mjs` — `buildZip(entries[])` controls method/flags/declared sizes/extra fields; `fixtures/ingest/xlsxkit.mjs` — `buildXlsx({sheets, merges, hiddenRows, hiddenCols, date1904, macro, externalLinks})`.

Synthesized attacks in `tests/adversarial/`:

| payload | where |
|---|---|
| zip entry `__proto__`, `../evil.xml`, `C:/`, `a//b.xml`, dup names, 2000/2001 entries, 4MiB-zero bomb, truncated tails, declared-size lies | ingest-corpus |
| hidden/veryHidden sheets, duplicate sheet names, sheet with merges+hidden rows+hidden cols, formula cells `{t:'f',f,v}`, externalLinks part | ingest-corpus |
| 32,000/32,001-char cells, 50k-row boundary, NUL/control bytes, `=cmd`-prefix cells, Arabic/mixed rows | ingest-corpus |
| 20k×100 near-empty CSV (2MB → 2M cells) | amplification |
| spans `{1..2^31-1}` (verified out-of-band OOM) + `{1..20M}` bounded demo | engine-edges |
| scenario costChange `-0.201/0.301/0.0001/abc/NaN`, zero-revenue snapshot | engine-edges |
| detached ArrayBuffer retry, superseded-export race, adoptUploadOutcome | session-lifecycle |
| hostile region `x","1")+999*0+("` in ExportModel metric scope | export-integrity |
| stale requestId/sessionId, schema-invalid envelopes, missing binary slot | protocol-guards |

## Regenerate

```sh
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
pnpm vitest run tests/adversarial   # all payloads rebuilt in-process
```
