# A22 — Adversarial product QA report

**Date:** 2026-09-20 · **Agent:** A22 (feat/red-team-qa) · **Contract:** v1.0.0
**Scope:** supported workflows attacked end-to-end — ingest (zip/xlsx/csv), normalize, analysis, scenario, provenance, export (xlsx/pptx), worker protocol, session lifecycle, egress surface.

**Environment:** node v24.19.0 · pnpm 12.5.1 · vitest 5.0.0 · Ubuntu (linux x64)
**Reproduce:** `pnpm vitest run tests/adversarial` → **7 files, 63 tests: 53 pass, 10 expected-fail** (each expected-fail is a demonstrated defect; `it.fails` asserts the correct contract and flips red on fix).

**Verdict:** 2 P0-class resource-exhaustion defects, 4 P1 correctness/integrity defects, 3 P2/latent defects. All defenses that currently hold are locked by regression tests. No data ever left the process; no untyped hang observed inside policy bounds; all malformed binaries terminated in typed errors.

---

## Findings (severity-ranked)

Severity rubric applied verbatim: **P0** = data leaves browser / executable-injected content / unrecoverable tab exhaustion / false evidence. **P1** = wrong supported calculation, source mapping, corrupted native file, unreadable Arabic, stale-snapshot export, or demo failure. **P2** = recoverable UI defect that does not falsify output.

### A22-F01 — P1 · Upload commit path always fails (demo failure)
`apps/web/src/app/controller.ts:251` — `adoptUploadOutcome()` calls `cancelWork('new source')`, which runs `analysis.cancel()` → `recreateWorker()`: the worker that retained the parsed `RawTable` (UploadFlow's parse port = `parseViaWorker` on `this.analysis`) is destroyed. The subsequent `normalize` request lands on a fresh supervisor with an empty `rawTables` map → `unknown rawTableId` → INTERNAL.
- **Expected:** committed UploadFlow outcome reaches `phase='ready'`.
- **Actual:** every upload through the committed UploadFlow path fails with INTERNAL.
- **Fixture:** any clean CSV; synthesized `date,region,amount` 2-row file.
- **Steps:** `parseViaWorker(bytes,…)` → `adoptUploadOutcome({table, inspection, parseOptions, approvalPlan, sourceHash})` → observe state.
- **Regression test:** `tests/adversarial/session-lifecycle.test.ts` → `it.fails('a committed UploadFlow outcome reaches phase ready')`.
- **Suggested owner fix:** do not `cancel()` the client that holds the retained table (skip `cancelWork` for the adopt path, or re-parse on a fresh worker and drop the retention contract).

### A22-F02 — P1 · User-approved formula-cache opt-in is silently dropped at the wire
`packages/contracts` `WorkerRequest.normalize` payload has no `useUnverifiedFormulaCaches` field (schema: `approvedIssueIds` + `columnConfirmations` only), and `apps/web/src/workers/supervisor.ts` `handleNormalize` hardcodes `useUnverifiedFormulaCaches: []`. UploadFlow collects the opt-in (`approvalPlan.useUnverifiedFormulaCaches`) — it is discarded silently; approved formula cells land `null` and are excluded from metrics.
- **Expected:** an approved use-cache column contributes its cached value.
- **Actual:** cell value `null` despite approval (verified over the real ingest+normalize wire path with a formula-bearing xlsx).
- **Fixture:** `buildXlsx` sheet with `{t:'f', f:'1+1', v:42}`.
- **Regression tests:** schema rejection lock + `it.fails('an opted-in formula cache flows to normalized values over the real wire path')` in `session-lifecycle.test.ts`.
- **Suggested owner fix:** add `useUnverifiedFormulaCaches` to the normalize payload schema (A01) + forward it in `handleNormalize` (app owner).

### A22-F04 — P1 · Stale export commits artifacts over a newer session
`export.done` / `export.finished` reducers carry no `requestId`/epoch guard. `prepareExport()` is phase-guarded, but once building, an export that outlives its source still commits: artifacts built from snapshot A's model merge into a session already committed to source B, and `export.finished` forces `phase:'ready'` unconditionally.
- **Expected:** superseded export artifacts are dropped (guarded by requestId or source epoch).
- **Actual:** stale artifacts commit; B's session exposes A's workbook bytes.
- **Reproduction:** commit CSV A → `prepareExport()` (held at a test gate inside the export writer) → `selectSource(B)` to ready → release gate → A's artifacts land.
- **Regression test:** `it.fails('a superseded export cannot record artifacts or force phase=ready')` in `session-lifecycle.test.ts`.
- **Suggested owner fix:** stamp `export.begin` with the active request/epoch and make `export.done`/`export.finished` no-ops when it no longer matches.

### A22-F06 — P1 · Regions filter silently returns all rows when no region column exists
`packages/analysis/src/scope.ts` `scopeRows`: `regions.length > 0 && regionColumn !== null` — when the table has no `region` column the gate degenerates to "no filter" and every row is retained, while the scope still reports a regional filter.
- **Expected:** a regional scope on a regionless table is unsatisfiable (0 rows) or refused.
- **Actual:** all rows retained → every downstream metric is falsified.
- **Fixture:** `rawTable` without a `region` column + `confirmedScope.regions=['North']`.
- **Regression test:** `it.fails('confirmedScope.regions must not silently pass all rows when no region column exists')` in `engine-edges.test.ts`.

### A22-F05 — P0 · Sparse-file resource amplification (measured)
CSV emits a `RawCell` for every empty-but-present field, and `profileTable` emits one issue per missing cell; the upload flow runs `profileTable` on the **main thread** (`WorkspaceScreen` ports). Measured on a legal 20k×100 near-empty CSV (2.06 MB, within every cap):

| file | cells | issues | parse | profile | RSS Δ |
|---|---|---|---|---|---|
| 2,060,392 B | 2,000,100 | 1,999,999 | 6,195 ms | 4,855 ms | +867 MB |

At the 50k-row envelope a ~5 MB file → ~5M cells + ~5M issue objects → multi-GB heap and a hard-frozen/hung tab. The 50,000-row/100-column limits were sized for *content*, not for materialized blank-field bookkeeping.
- **Expected:** issues deduplicated/capped; blank fields do not materialize per-cell objects.
- **Actual:** ~N² object amplification, unbounded by any cap.
- **Regression test:** `it.fails('a within-limits 20k×100 near-empty CSV …')` in `amplification.test.ts` (+ dense control case, ragged-row bound).

### A22-F07 — P0 · `expandSpans` materializes unbounded row-id arrays
`packages/provenance/src/spans.ts` expands spans one `push` per row with no cap. `expandSpans([{start:1, end:2^31-1}])` crashes the process — verified out-of-band (fatal V8 heap exhaustion, not a catchable error). In-browser this is unrecoverable tab kill. Demonstrated bounded at 20M rows (~seconds, ~160 MB) inside the suite.
- **Expected:** typed refusal (or capped iterator) once the expansion exceeds the source/evidence bound.
- **Actual:** O(N) unbounded allocation to process death.
- **Regression test:** `it.fails('expandSpans must refuse oversize spans, not materialize millions of ids')` in `engine-edges.test.ts`.

### A22-F03 — P2 · Parse retry reuses a detached ArrayBuffer and can never succeed
`parseViaWorker` transfers `bytes` as a transferable (real Worker → detached). `UploadFlow.retry()` re-submits `state.file.bytes` — the same now-detached buffer → retry always re-fails.
- **Expected:** a recoverable parse error can be retried with the same picked file.
- **Actual:** retry submits a 0-byte/detached buffer.
- **Fixture:** `detachBuffer()` (node MessageChannel transfer) simulates the real browser detach exactly.
- **Regression test:** `it.fails('a parse retry after a recoverable error can reuse the original file bytes')` in `session-lifecycle.test.ts`.

### A22-F08 — P2 · Sanitized zip repack silently drops an entry named `__proto__`
`zip-preflight.ts` repacks via `zipSync` keyed by a plain `Record` — `stored['__proto__'] = bytes` mutates the prototype instead of storing. `entries`/`order` still list the entry; the repacked zip (what SheetJS sees) lacks it → preflight sees N entries, the parser sees N−1.
- **Expected:** repack preserves every admitted entry (or the name is refused up front).
- **Actual:** silent divergence between admission check and the bytes actually parsed.
- **Fixture:** `buildZip` array-form entry `{name:'__proto__'}` + `note.txt`.
- **Regression test:** `it.fails('entry named __proto__ is dropped from the sanitized repack')` in `ingest-corpus.test.ts`.

### A22-F10 — P2 (latent) · `quantizeMoney` emits non-canonical `-0.00`
`quantizeMoney('-0.004', 2)` → `'-0.00'` — violates the canonical-decimal rule (`isDecimal('-0.00') === false`). Latent today: `runScenario` only feeds inputs with fraction length ≤ places.
- **Regression test:** `it.fails('quantizeMoney never emits negative zero')` in `engine-edges.test.ts`.

### A22-F11 — P2 (latent) · SUMIFS criteria interpolates scope regions unescaped
`export-xlsx` `sumIfsFormula` embeds `region` inside a quoted criteria string without doubling `"` — a region like `x","1")+…` breaks the literal and injects formula text into the generated workbook. Latent: template formulas are written only for the bound sample pack whose regions are fixed ('North'); the moment non-sample exports emit SUMIFS this becomes P0 (injected formula in a native artifact).
- **Regression test:** `it.fails('a region containing a double quote must not corrupt the SUMIFS criteria')` in `export-integrity.test.ts`.
- **Suggested owner fix:** escape `"` → `""` (or restrict criteria interpolation to schema-pinned sample regions).

---

## Verified defenses (locked by regression `it` tests)

- **Envelope guards:** stale `requestId`/`sessionId`/`revision` responses dropped+diagnostic; schema-invalid/missing-binary-slot responses → SCHEMA_MISMATCH; second in-flight request refused; watchdog → TIMEOUT + worker recreation; `cancel()` → CANCELLED + fresh worker.
- **Supervisor:** malformed envelope → typed error; unknown `rawTableId` → INTERNAL error; `dispose` clears retained tables.
- **Zip structure:** traversal (`../`, absolute, drive-letter, `.`, `//`), duplicate names, >2000 entries, >10MiB compressed, >32MiB per-entry, >200:1 expansion, truncated archives, declared-size lies — all typed refusals, diagnostics carry codes only (no attacker bytes).
- **XLSX:** encrypted (flag-forged), macro-enabled, OLE2 `.xls`, ODS masquerade, not-a-workbook — all `UNSUPPORTED`/`INVALID_FILE` typed, no hangs.
- **CSV:** exact 32,000-char cell cap, 50k-row cap, compressed-byte cap, NUL/control bytes, invalid UTF-8 → fatal INVALID_FILE; formula-looking cells are inert text; Arabic/mixed rows round-trip; `inspectSource` preview bounded at 30 rows.
- **Engines:** huge-magnitude `addDecimal` exact; divide-by-zero throws typed; scenario bounds enforced (`invalid-cost-change`, no clamping); zero revenue → `unavailable`+reasonKey (never NaN/∞); `readEvidencePage` rejects pageSize>500 and offset<0; non-canonical span sets rejected by `validateSpans`; formula caches land verbatim and aggregate as missing with a surfaced issue.
- **Export:** user text → shared strings only (never `<f>`); sheet-name guard rejects `[]:*?/\`/controls/>31`; `buildExportModel` refuses stale table id/revision/hash and foreign-baseline scenarios; pptx overflow → typed `layout-overflow`.
- **Privacy:** static scan of every shipped `ts/tsx/css/html` — zero `fetch`/XHR/beacon/WebSocket/EventSource/remote-url outside the single sanctioned sample-asset loader (`apps/web/src/app/sample.ts`); worker sources contain no network primitives at all.

## Coverage map (task attack list → suite)

malformed/large/wide/merged/hidden/formula-bearing spreadsheets → ingest-corpus · huge numbers/strange dates/zero denominators/invalid scenarios → engine-edges · interrupted parse/export + raced supersede → session-lifecycle · stale response rejection → protocol-guards · injected formulas → export-integrity + ingest-corpus (CSV `=` cells inert) · hangs/exhaustion → amplification + F07 · exfiltration → privacy-egress · file corruption/retry + max-envelope → session-lifecycle F03 + amplification.

## Limitations & pending checks (not runnable in this agent's env)

- **Browser-runtime checks pending:** real `Worker` transfer semantics, `offline-after-assets-load` behavior, `prefers-reduced-motion`/mobile breakpoints (code-verified present: `useReducedMotion`, `@media (prefers-reduced-motion: reduce)`, `@media (max-width: 767px)`) — covered by e2e/accessibility owners' harnesses; flagged as pending manual checks.
- F05/F07 measurements are Node-heap numbers; browser tab limits are lower — the browser-side OOM margin is *worse* than reported.
- F11/F10 are latent (unreachable today); classified honestly rather than claimed as shipped breakage.

## Fixture corpus

Every attack payload is synthetic and regenerable: in-test via `fixtures/ingest/zipkit.mjs` + `fixtures/ingest/xlsxkit.mjs`, or checked into `fixtures/ingest/generated/` and `fixtures/hostile/generated/` (23-case index with sha256 — see `CORPUS.md`). No private data, no real spreadsheets.
