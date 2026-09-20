# Adversarial product QA report

**Date:** 2026-09-20 · **Contract:** v1.0.0 · **Suite:** `tests/adversarial/`
**Scope:** supported workflows attacked end-to-end — ingest (zip/xlsx/csv), normalize, analysis, scenario, provenance, export (xlsx/pptx), worker protocol, session lifecycle, egress surface.

**Environment:** node v24.19.0 · pnpm 12.5.1 · vitest 5.0.0 · Ubuntu (linux x64)
**Reproduce:** `pnpm vitest run tests/adversarial` → **7 files, 64 tests: 60 pass, 4 expected-fail** (each expected-fail is a demonstrated defect; `it.fails` asserts the correct contract and flips red on fix).

**Verdict:** 6 of 10 findings fixed upstream and retained as regression locks (F01 `d8beb01`; F02/F03/F04 `a6d6af1`; F05 `3cc85d0`; F08 `b60478c`). Open: **F07** (P0, unbounded `expandSpans` → tab kill), **F06** (P1, regions filter silently no-ops on regionless tables), **F10/F11** (P2 latent). No data ever left the process; no untyped hang observed inside policy bounds; all malformed binaries terminate in typed errors.

---

## Findings (severity-ranked)

Severity rubric applied verbatim: **P0** = data leaves browser / executable-injected content / unrecoverable tab exhaustion / false evidence. **P1** = wrong supported calculation, source mapping, corrupted native file, unreadable Arabic, stale-snapshot export, or demo failure. **P2** = recoverable UI defect that does not falsify output.

### F07 — P0 · `expandSpans` materializes unbounded row-id arrays — OPEN
`packages/provenance/src/spans.ts` expands spans one `push` per row with no cap. `expandSpans([{start:1, end:2^31-1}])` crashes the process — verified out-of-band (fatal V8 heap exhaustion, not a catchable error). In-browser this is unrecoverable tab kill. Demonstrated bounded at 20M rows (~seconds, ~160 MB) inside the suite.
- **Expected:** typed refusal (or capped iterator) once the expansion exceeds the source/evidence bound.
- **Actual:** O(N) unbounded allocation to process death.
- **Regression test:** `it.fails('expandSpans must refuse oversize spans, not materialize millions of ids')` in `engine-edges.test.ts`.

### F06 — P1 · Regions filter silently returns all rows when no region column exists — OPEN
`packages/analysis/src/scope.ts` `scopeRows`: `regions.length > 0 && regionColumn !== null` — when the table has no `region` column the gate degenerates to "no filter" and every row is retained, while the scope still reports a regional filter.
- **Expected:** a regional scope on a regionless table is unsatisfiable (0 rows) or refused.
- **Actual:** all rows retained → every downstream metric is falsified.
- **Fixture:** `rawTable` without a `region` column + `confirmedScope.regions=['North']`.
- **Regression test:** `it.fails('confirmedScope.regions must not silently pass all rows when no region column exists')` in `engine-edges.test.ts`.

### F05 — P0 · Sparse-file resource amplification — FIXED upstream at `3cc85d0`
A legal-but-sparse CSV materialized a `RawCell` per empty field plus one issue per missing cell, and `profileTable` ran on the main thread: a 2.06 MB, 20k×100 near-empty CSV produced 2,000,100 cells + 1,999,999 issues, 6.2s parse + 4.9s profile, +867 MB RSS; at the 50k-row envelope → multi-GB heap and a frozen tab.
- **Fix:** bounded sparse-range ingestion (over-envelope position count refuses typed `LIMIT_EXCEEDED`), blank-cell materialization skipped, profile moved to a worker op. Verified: `it('an over-envelope sparse CSV is refused as a typed LIMIT_EXCEEDED…')` + `it('a within-limits sparse CSV emits no blank-cell objects and bounded issues')` in `amplification.test.ts`.

### F01 — P1 · Upload commit path always fails — FIXED upstream at `d8beb01`
`adoptUploadOutcome()` called `cancelWork('new source')` → the worker retaining the parsed `RawTable` was destroyed → `normalize` landed on a fresh supervisor → `unknown rawTableId` → INTERNAL. Fix removed `cancelWork` + added live-request-id failure routing; covered additionally by `apps/web/src/app/controller.test.ts` and Journey 3 e2e.
- **Regression lock:** `it('a committed UploadFlow outcome reaches phase ready')` in `session-lifecycle.test.ts`.

### F02 — P1 · User-approved formula-cache opt-in silently dropped at the wire — FIXED upstream at `a6d6af1`
`WorkerRequest.normalize` had no `useUnverifiedFormulaCaches` slot (schema-verified) and `handleNormalize` hardcoded `[]` — the user's review approval was discarded. Fix: schema source + regenerated types carry the field, supervisor forwards it, adopt path passes `approvalPlan.useUnverifiedFormulaCaches`. Verified over the real ingest→normalize wire (formula xlsx → `values['amount'] === '42'`).
- **Regression locks:** `it('WorkerRequest schema accepts a normalize payload carrying useUnverifiedFormulaCaches')` + `it('an opted-in formula cache flows to normalized values over the real wire path')` in `session-lifecycle.test.ts`.

### F04 — P1 · Stale export commits artifacts over a newer session — FIXED upstream at `a6d6af1`
`export.done`/`export.finished` carried no requestId/epoch guard → a superseded export landed snapshot-A artifacts on session B and forced `phase:'ready'`. Fix: `export.begin` stamps `epoch = state.revision`; `done`/`failed`/`finished`/`progress` drop mismatched-epoch commits.
- **Regression lock:** `it('a superseded export cannot record artifacts or force phase=ready')` in `session-lifecycle.test.ts`.

### F03 — P2 · Parse retry reuses a detached ArrayBuffer — FIXED upstream at `a6d6af1`
`parseViaWorker` transferred the caller's `bytes` (real Worker → detached); `UploadFlow.retry()` re-submitted the same `file.bytes` → retry always re-failed. Fix: transfer `bytes.slice(0)`.
- **Regression lock:** `it('a parse retry after a recoverable error can reuse the original file bytes')` in `session-lifecycle.test.ts`.

### F08 — P2 · `__proto__` zip entry — FIXED upstream at `b60478c`
The repack keyed a plain `Record` so `stored['__proto__'] = bytes` mutated the prototype — the entry was silently absent from the zip SheetJS saw. An intermediate fix (`Object.create(null)`, `a6d6af1`) moved the pollution inside fflate's own plain-object accumulator → untyped `TypeError`. Final fix: `normalizeZipPath` refuses reserved names (`zip.path-reserved`, typed `IngestError`) — the recommended remediation.
- **Regression lock:** `it('entry named __proto__ is preserved by the repack or refused as a typed error')` in `ingest-corpus.test.ts`.

### F10 — P2 (latent) · `quantizeMoney` emits non-canonical `-0.00` — OPEN
`quantizeMoney('-0.004', 2)` → `'-0.00'` — violates the canonical-decimal rule (`isDecimal('-0.00') === false`). Latent today: `runScenario` only feeds inputs with fraction length ≤ places.
- **Regression test:** `it.fails('quantizeMoney never emits negative zero')` in `engine-edges.test.ts`.

### F11 — P2 (latent) · SUMIFS criteria interpolates scope regions unescaped — OPEN
`export-xlsx` `sumIfsFormula` embeds `region` inside a quoted criteria string without doubling `"` — a region like `x","1")+…` breaks the literal and injects formula text into the generated workbook. Latent: template formulas are written only for the bound sample pack whose regions are fixed ('North'); the moment non-sample exports emit SUMIFS this becomes P0 (injected formula in a native artifact).
- **Regression test:** `it.fails('a region containing a double quote must not corrupt the SUMIFS criteria')` in `export-integrity.test.ts`.
- **Suggested fix:** escape `"` → `""` (or restrict criteria interpolation to schema-pinned sample regions).

---

## Verified defenses (locked by regression `it` tests)

- **Envelope guards:** stale `requestId`/`sessionId`/`revision` responses dropped+diagnostic; schema-invalid/missing-binary-slot responses → SCHEMA_MISMATCH; second in-flight request refused; watchdog → TIMEOUT + worker recreation; `cancel()` → CANCELLED + fresh worker.
- **Supervisor:** malformed envelope → typed error; unknown `rawTableId` → INTERNAL error; `dispose` clears retained tables.
- **Zip structure:** traversal (`../`, absolute, drive-letter, `.`, `//`), duplicate names, reserved names, >2000 entries, >10MiB compressed, >32MiB per-entry, >200:1 expansion, truncated archives, declared-size lies — all typed refusals, diagnostics carry codes only (no attacker bytes).
- **XLSX:** encrypted (flag-forged), macro-enabled, OLE2 `.xls`, ODS masquerade, not-a-workbook — all `UNSUPPORTED`/`INVALID_FILE` typed, no hangs.
- **CSV:** exact 32,000-char cell cap, 50k-row cap, compressed-byte cap, sparse-range bound, NUL/control bytes, invalid UTF-8 → fatal INVALID_FILE; formula-looking cells are inert text; Arabic/mixed rows round-trip; `inspectSource` preview bounded at 30 rows.
- **Engines:** huge-magnitude `addDecimal` exact; divide-by-zero throws typed; scenario bounds enforced (`invalid-cost-change`, no clamping); zero revenue → `unavailable`+reasonKey (never NaN/∞); `readEvidencePage` rejects pageSize>500 and offset<0; non-canonical span sets rejected by `validateSpans`; formula caches land verbatim and aggregate as missing with a surfaced issue.
- **Export:** user text → shared strings only (never `<f>`); sheet-name guard rejects `[]:*?/\`/controls/>31`; `buildExportModel` refuses stale table id/revision/hash and foreign-baseline scenarios; pptx overflow → typed `layout-overflow`.
- **Privacy:** static scan of every shipped `ts/tsx/css/html` — zero `fetch`/XHR/beacon/WebSocket/EventSource/remote-url outside the single sanctioned sample-asset loader (`apps/web/src/app/sample.ts`); worker sources contain no network primitives at all.

## Coverage map (attack list → suite)

malformed/large/wide/merged/hidden/formula-bearing spreadsheets → `ingest-corpus` · huge numbers/strange dates/zero denominators/invalid scenarios → `engine-edges` · interrupted parse/export + raced supersede → `session-lifecycle` · stale response rejection → `protocol-guards` · injected formulas → `export-integrity` + `ingest-corpus` (CSV `=` cells inert) · hangs/exhaustion → `amplification` + F07 · exfiltration → `privacy-egress` · file corruption/retry + max-envelope → `session-lifecycle` F03 + `amplification`.

## Limitations & pending checks

- **Browser-runtime checks pending:** real `Worker` transfer semantics, `offline-after-assets-load` behavior, `prefers-reduced-motion`/mobile breakpoints (code-verified present) — covered by e2e/accessibility harnesses; flagged as pending manual checks.
- Heap measurements are Node-side; browser tab limits are lower — the browser-side OOM margin is *worse* than reported.
- F10/F11 are latent (unreachable today); classified honestly rather than claimed as shipped breakage.

## Fixture corpus

Every attack payload is synthetic and regenerable: in-test via `fixtures/ingest/zipkit.mjs` + `fixtures/ingest/xlsxkit.mjs`, or checked into `fixtures/ingest/generated/` and `fixtures/hostile/generated/` (23-case index with sha256 — see `CORPUS.md`). No private data, no real spreadsheets.
