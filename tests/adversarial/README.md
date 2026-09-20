# tests/adversarial — A22 adversarial QA corpus

Bounded attack suites against the real engines (no fixtures on the wire):
`parseSource`/`inspectSource`, `profileTable`/`normalizeTable`, `analyze`,
`runScenario`, `buildExportModel`, `buildWorkbook`, `buildPresentation`, plus
the real `SessionController` ⇄ `WorkerClient` ⇄ `WorkerSupervisor` loop
bridged in-process via `InProcessWorker` (`apps/web/src/workers/test-helpers`).

## Conventions

- **`it.fails` = demonstrated defect.** The assertion encodes the CORRECT
  contract; the test is green only while the bug exists, so it flips red the
  moment the owning agent fixes it (a tripwire, not a mute).
- **`it` = verified-good regression lock.** Defenses that currently hold stay
  locked so a future refactor cannot silently reopen the attack.
- Every defect id (`A22-F##`) is referenced in `docs/qa/red-team/REPORT.md`.
- All payloads are synthesized in-test via the checked-in kits
  (`fixtures/ingest/zipkit.mjs`, `fixtures/ingest/xlsxkit.mjs`) or the
  generated hostile corpus (`fixtures/hostile/generated/`,
  `fixtures/ingest/generated/`) — deterministic, no network, no secrets.
- Bounds: the largest payloads stay far below the point that would OOM the
  test worker; the true max-envelope extrapolations live in the report.

## Run

```sh
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"   # node not on PATH
pnpm vitest run tests/adversarial
```

Expected: 7 files, 63 tests — 53 pass, **10 expected-fail (the defects)**.

## Files

| file | surface |
|---|---|
| `ingest-corpus.test.ts` | zip structure, bomb/truncation/traversal/dup, xlsx masquerades, dimension lies, csv caps/UTF-8/NUL/injection, preview bounds |
| `session-lifecycle.test.ts` | adoptUploadOutcome F01, formula-cache wire drop F02, detached-buffer retry F03, stale export F04 + good-path locks |
| `protocol-guards.test.ts` | envelope guards: stale requestId/sessionId drops, schema-mismatch fails, slot loss, in-flight single-flight, watchdog, cancel |
| `engine-edges.test.ts` | decimal edges, scenario bounds/zero denominators, regions-no-column F06, expandSpans F07, formatted formula caches, analyze oracle reconciliation |
| `export-integrity.test.ts` | SUMIFS region injection F11, user text vs `<f>` formulas, stale-model/scenario-mismatch refusals, sheet-name guards |
| `amplification.test.ts` | sparse-file amplification F05 + dense control + ragged-row bound |
| `privacy-egress.test.ts` | static scan: no fetch/XHR/beacon/WebSocket/remote URLs in shipped source except the sample-asset loader |
| `helpers.ts` | byte builders, `rawTable` builder, `detachBuffer` (simulates real Worker transfer), fixture paths |
