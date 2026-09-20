# tests/adversarial — bounded attack corpus

Bounded attack suites against the real engines (no fixtures on the wire):
`parseSource`/`inspectSource`, `profileTable`/`normalizeTable`, `analyze`,
`runScenario`, `buildExportModel`, `buildWorkbook`, `buildPresentation`, plus
the real `SessionController` ⇄ `WorkerClient` ⇄ `WorkerSupervisor` loop
bridged in-process via `InProcessWorker` (`apps/web/src/workers/test-helpers`).

## Conventions

- **`it.fails` = demonstrated defect.** The assertion encodes the CORRECT
  contract; the test is green only while the bug exists, so it flips red the
  moment the fix lands (a tripwire, not a mute). Promote it to `it` when the
  real fix ships.
- **`it` = verified-good regression lock.** Defenses that currently hold stay
  locked so a future refactor cannot silently reopen the attack.
- All payloads are synthesized in-test via the checked-in kits
  (`fixtures/ingest/zipkit.mjs`, `fixtures/ingest/xlsxkit.mjs`) or the
  generated hostile corpus (`fixtures/hostile/generated/`,
  `fixtures/ingest/generated/`) — deterministic, no network, no secrets.
- Bounds: payloads stay far below the point that would exhaust the test
  worker; the suite never executes OOM-scale cases.

## Run

```sh
pnpm vitest run tests/adversarial
```

## Files

| file | surface |
|---|---|
| `ingest-corpus.test.ts` | zip structure, bomb/truncation/traversal/duplicate entries, xlsx masquerades, dimension lies, csv caps/UTF-8/NUL/injection, preview bounds, reserved entry names |
| `session-lifecycle.test.ts` | upload-adoption commit path, formula-cache wire opt-in, detached-buffer retry, stale-export epoch guard + good-path locks |
| `protocol-guards.test.ts` | envelope guards: stale requestId/sessionId drops, schema-mismatch fails, slot loss, in-flight single-flight, watchdog, cancel |
| `engine-edges.test.ts` | decimal edges, scenario bounds/zero denominators, regions-on-regionless scope, span-expansion bounds, formatted formula caches, oracle reconciliation |
| `export-integrity.test.ts` | SUMIFS criteria escaping, user text vs `<f>` formulas, stale-model/scenario-mismatch refusals, sheet-name guards |
| `amplification.test.ts` | sparse-file amplification guard + dense control + ragged-row bound |
| `privacy-egress.test.ts` | static scan: no fetch/XHR/beacon/WebSocket/remote URLs in shipped source except the sample-asset loader |
| `helpers.ts` | byte builders, `rawTable` builder, `detachBuffer` (simulates real Worker transfer), fixture paths |
