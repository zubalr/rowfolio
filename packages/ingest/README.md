# @rowfolio/ingest

Safe workbook ingestion for Rowfolio — UTF-8 CSV and unencrypted XLSX only.
Pure, synchronous-in-effect, worker-boundary safe: every input is bounded,
every failure is typed and actionable, and source bytes never leave the
browser.

## Public surface

```ts
import {
  parseSource,          // contract ParseSource: (bytes, sourceName, options, progress) => RawTable
  inspectSource,        // bounded sheet listing + preview for the upload UI
  handleIngestRequest,  // worker supervisor glue (binary slot → parseSource)
  IngestError, isIngestError, toWorkerError,
  WARNINGS,
} from '@rowfolio/ingest';
```

`parseSource` implements the v1.0.0 contract signature and additionally
accepts an optional fifth argument of caller extras (`IngestExtras`):
`signal` (cooperative cancellation), `delimiter` (CSV ambiguity override),
`limits` (tests/diagnostics — never relax in production).

## Pipeline

1. **Sniff bytes** — `PK` magic → XLSX pipeline; OLE2 magic → `UNSUPPORTED`;
   anything else → CSV. Extensions/MIME are hints only.
2. **ZIP preflight (XLSX)** — the central directory is attacker-controlled,
   so we scan it ourselves first: entry count, encryption/masked-CD flags,
   compression method (stored/deflate only), path normalization, traversal,
   duplicates, declared sizes. Then fflate streams local entries while we
   count **actual** decompressed bytes per entry and cumulatively —
   `terminate()` halts before allocation growth at any cap. Validated
   entries are repacked stored-only into a sanitized ZIP; SheetJS never
   sees attacker ZIP structure.
3. **Package classification** — `[Content_Types].xml` + rels: rejects
   macro-enabled (`vbaProject`, `macroEnabled` type), binary workbooks
   (`workbook.bin`), encrypted packages (`EncryptionInfo`), ODS masquerades,
   and ZIPs without a workbook part.
4. **Bounded parse** — SheetJS reads only the selected sheet (dense mode,
   `sheets` + content bounds). A raw sheet-XML scan recovers disclosures
   SheetJS drops: hidden rows/cols and formula cells without cached values.

## Invariants

- **Coordinates are physical, 1-based.** `RawCell.row/column` are source
  positions; CSV `row` is the record's start line (its end line is derivable
  from the next record's start or the range end). Gaps (skipped lines,
  empty rows) are real and preserved.
- **Raw means raw.** Numbers keep exact decimal serialization; dates stay
  serial strings tagged `date` with the workbook `dateSystem` (serial 60 in
  the 1900 system is reported via `ingest.warn.invalid-date-serial`, never
  converted); text keeps leading zeros; formulas keep `=…` text plus the
  optional cached value — never evaluated.
- **Headers keep position.** Duplicate/blank headers emit explicit `blank`
  cells in the header row so downstream field-identity mapping is stable.
- **Disclosure, not inference.** Merged ranges, hidden rows/cols, hidden
  sheets and external references surface as stable warning codes
  (`WARNINGS`); nothing is forward-filled, resolved or fetched.
- **Default header row** = the first nonempty row whose width equals the
  modal width of the first 30 nonempty rows (skips narrow title rows).
  `options.headerRow` overrides with a physical row/line number.

## Failure taxonomy

| code | meaning | examples |
| --- | --- | --- |
| `INVALID_FILE` | malformed bytes or bad selection | bad ZIP, non-XML part, sheet id unknown, header row off-grid |
| `LIMIT_EXCEEDED` | a declared POLICY cap | entries, expanded bytes, ratio, rows, columns, cells, cell chars |
| `AMBIGUOUS_INPUT` | needs a user decision | CSV delimiter ambiguity (resolve via `extras.delimiter`) |
| `UNSUPPORTED` | valid but out of scope | OLE2/XLS/XLSB/ODS, encrypted, macro-enabled, hidden sheet w/o opt-in |
| `CANCELLED` | caller aborted | AbortSignal observed at a checkpoint |
| `SCHEMA_MISMATCH` | envelope contract broken | missing binary slot, byteLength mismatch |
| `INTERNAL` | our bug | assembled RawTable failed its own contract check |

`IngestError.detail` is a stable machine-readable qualifier
(`zip.path-traversal`, `csv.ambiguous-delimiter`, …) — never source content.
`toWorkerError` maps any thrown value to `{code, messageKey: 'error.<CODE>',
recoverable, detail}`; the `error.*` keys already exist in the contract
translation manifest.

## Cancellation & watchdog

The package never blocks longer than one checkpoint: `checkAbort(signal)`
runs inside ZIP onfile/ondata, per CSV record and during emission, and long
loops yield to the event loop every ~2048 iterations so a worker supervisor
can deliver cancellation. The supervisor still owns the outer watchdog
(`POLICY.limits.watchdogMs`) — these are the integration points.

## Determinism

Output depends only on input bytes + options: IDs derive from
`sha256(sourceBytes)` + sheet ordinal + selected range; no clocks, randomness
or environment reads.

## What this package does NOT do

Business-semantics inference, type coercion, unit/date guessing, forward
filling, external resource resolution, or any network/disk I/O. Those belong
to `normalize`/`provenance` downstream.
