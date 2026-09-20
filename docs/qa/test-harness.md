# Test harness

Reusable testing and evidence utilities for Rowfolio: deterministic
Vitest/fast-check helpers, independent native-file inspectors, bounded
synthetic hostile fixtures, and screenshot-metadata capture. Everything
here is deterministic and dependency-light — the checks must prove they
*detect* planted defects, not merely pass on clean input.

## Layout

| Path | Contents |
| --- | --- |
| `tests/helpers/` | Vitest-consumable helpers + the harness self-tests (`*.test.ts`) |
| `tooling/test/` | Dependency-free inspection/checker modules + CLIs (no `package.json`; not a workspace member) |
| `tooling/test/tests/` | Python stdlib unittest suite for `inspect_native.py` |
| `fixtures/hostile/` | Bounded synthetic hostile fixtures + `manifest.json` + deterministic generator |
| `docs/qa/test-harness.md` | This document |

Reserved paths owned by the external bulk worker — do not create them:
`fixtures/hostile/generated/`, `tooling/test/corpus/`.

## Commands

```bash
# vitest — includes all harness self-tests under tests/helpers/
pnpm test

# harness battery + corpus (fails if any planted mutation is missed)
node tooling/test/selfcheck.ts

# corpus runner: verify manifest fixtures, or rewrite the committed report
node tooling/test/run_corpus.ts
node tooling/test/run_corpus.ts --write

# inspect arbitrary native files (xlsx/zip/cfb), JSON report per file
node tooling/test/inspect.ts <file...> [--require-clean]

# python cross-check inspector (stdlib only, zero deps)
python3 tooling/test/inspect_native.py <file> [--json] [--require-clean]
python3 -m unittest discover -s tooling/test/tests -v

# regenerate + byte-verify the native hostile artifacts
node fixtures/hostile/generate.ts --verify

# typecheck the harness itself (repo-wide `pnpm typecheck` does not cover it)
npx tsc -p tooling/test/tsconfig.json --noEmit
npx tsc -p tests/helpers/tsconfig.json --noEmit
```

Node 22+/24 (repo pins 22.23.2; developed on 24.19.0). Python ≥3.10 for
the cross-check inspector. Requires `pnpm install` for vitest/fast-check
only — `tooling/test` uses nothing but `node:zlib`/`node:crypto`.

## Design: three verification layers

1. **Contract validators** (`packages/contracts`, A01) — the wire
   authority for schemas, freshness, envelopes and decimals.
2. **Independent JS inspectors** (`tooling/test`) — re-implemented
   checks: own CRC32/ZIP reader, OOXML relationship scanner, CFB
   detector, envelope/locale/metric checkers. They never import
   `packages/contracts`.
3. **Independent Python inspector** (`inspect_native.py`) — stdlib only
   (`zipfile`, `xml.etree`, `struct`).

Self-tests assert the layers *agree* — a regression in either surfaces
as a disagreement, not a silent pass. Where semantics legitimately
differ it is documented in code (e.g. contract decimals are canonical;
the independent normalizer preserves declared scale, making oracle
comparisons scale-strict).

## Fixture envelope

Synthetic, bounded, generator-produced — no private/business workbooks:

- max file size: **64 KiB** (65536 bytes)
- max expanded size: **8 MiB**
- max archive entries: **64**

`tests/helpers/inspect.test.ts` enforces the envelope from
`fixtures/hostile/manifest.json`; `tooling/test/corpus-report.json` is a
deterministic report (sha256 + findings per fixture) that a committed
copy must equal byte-for-byte — the committed file is proof the corpus
was run, and `corpus.test.ts` re-verifies it.

## Planted-defect coverage

`selfcheck.ts` + the manifest corpus prove detection of:

- **wrong metric** (`metric.mismatch` via `MetricMismatch`/oracle diffs)
- **external relationship** (`ooxml.external-relationship`,
  `ooxml.external-link-part`)
- **stale/invalid worker response** (`envelope.stale`,
  `envelope.invalid`, plus contract `classifyWorkerResponse` agreement)
- **corrupted ZIP** (truncation, bad CRC, CD count lie, declared
  oversize, traversal, nested archive, macro, encrypted CFB)
- **missing locale key / placeholder drift** (`locale.missing-key`,
  `locale.placeholder-mismatch`, `locale.extra-key`, `locale.empty-value`)
- **CSV hazards** (`csv.formula-prefix`, `csv.cell-overflow`,
  `csv.ragged-row`, `csv.binary-bytes`, `csv.row-limit`)
- **envelope slot errors** (`envelope.slot-missing`,
  `envelope.slot-duplicate`, `envelope.slot-size`) and progress
  regression (`progress.regression`)

## Property tests and failing seeds

`assertProperty(name, fc.property(...), { seed?, numRuns? })` wraps
fast-check with reproducible seeds:

- seed resolution: `ROWFOLIO_FC_SEED` env → `FC_SEED` env → explicit
  `seed` option → fresh random.
- on failure, a JSONL record `{name, seed, path, counterexample}` is
  appended to `tests/helpers/artifacts/failing-seeds.jsonl`
  (gitignored) and the thrown error includes
  `ROWFOLIO_FC_SEED=<seed> pnpm test` for replay.

Bundled arbitraries: `arbCanonicalDecimal`, `arbLooseDecimal`,
`arbRowSpans` (sorted/disjoint/non-adjacent), `arbUnsafeCellText`,
`arbIsoDate` — each validated by self-tests.

## Playwright-facing helpers (for e2e suites)

- `collectRequests(page)` + `scanRequestsForEgress(requests, policy)` —
  post-run assertion that no cross-origin or non-read-only request left
  the browser; optional canary tokens flag accidental data egress.
- `installStaticAllowlist(page, { origin, assetRoot })` — serves
  same-origin static files, aborts + records everything else. Use it to
  prove zero egress during golden-path e2e runs.
- `captureEvidenceShot(page, name, ctx)` — PNG + `.meta.json` sidecar
  carrying sha256, bytes, viewport, locale/direction, reduced-motion,
  color scheme, commit and contract version; `shotsManifest()` writes a
  sorted manifest.

These are pure except for a thin Playwright glue layer; the pure logic
is covered by `network.test.ts` / `screenshot.test.ts`.

## Writing new tests with the helpers

```ts
import {
  assertProperty, arbUnsafeCellText, expectFreshnessAgree, guard,
  assertOracleFields, assertCatalogParity, inspectHostileFixture,
} from '../helpers/index.ts';
```

Keep suites deterministic: no wall-clock assertions, no network, no
environment-dependent paths. If a check needs a real file, add a
generator entry in `fixtures/hostile/generate.ts` and a manifest line —
do not check in opaque binaries.
