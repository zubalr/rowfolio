# Dependency freeze report — bootstrap (A00)

Frozen 2026-09-20 · Node `22.23.2` (`.node-version`) · pnpm `12.5.1` (`packageManager`).
Machine-readable inventory: `dependency-inventory.json` (regenerate + recommit with
`pnpm report:freeze`; `pnpm audit:licenses` fails the build if it drifts).

## How the tree is frozen

- Every workspace `package.json` declares **exact versions only** — no `^`, `~`,
  `>=`, tags or ranges. The single source of resolution truth is `pnpm-lock.yaml`.
- `pnpm install --frozen-lockfile` is the only sanctioned install path (CI
  enforces it in `.github/workflows/bootstrap.yml`).
- SheetJS is vendored, not registry-installed: `vendor/xlsx-0.20.3.tgz` is the
  official CDN tarball, SHA-256 `8dc73fc3…99fe8` (see `vendor/README.md`), wired
  into `packages/ingest` as `file:../../vendor/xlsx-0.20.3.tgz`. The public npm
  `xlsx` entry is stale at 0.18.5 and is never referenced.
- Version recency was checked at resolution time: every direct pin was published
  ≥7 days before freeze (vulnerabilities surface fast; brand-new releases are
  not vetted). One transitive exception exists — see findings below.

## Resolved runtime baseline

| Package | Version | License | Owner package |
|---|---|---|---|
| react / react-dom | 19.3.0 | MIT | `@rowfolio/web`, `ui`, `charts` |
| vite | 8.3.0 | MIT | `@rowfolio/web` (build) |
| @vitejs/plugin-react | 6.1.1 | MIT | `@rowfolio/web` |
| xlsx (SheetJS CE) | 0.20.3 vendored | Apache-2.0 | `ingest` |
| papaparse | 5.7.0 | MIT | `ingest` |
| fflate | 0.8.3 | MIT | `ingest` |
| decimal.js | 10.6.0 | MIT | `normalize`, `analysis`, `provenance`, `scenario`, `export-model` |
| d3-scale / d3-shape / d3-array | 4.0.2 / 3.2.0 / 3.2.4 | ISC | `charts` |
| motion | 13.2.0 | MIT | `web`, `ui` |
| exceljs | 4.4.0 | MIT | `export-xlsx` |
| pptxgenjs | 4.0.1 | MIT | `export-pptx` |

Development toolchain (not shipped): typescript 5.9.3, vitest 5.0.0,
eslint 10.10.0 + typescript-eslint 8.70.0, @playwright/test 1.63.0,
fast-check 4.10.0, axe-core 4.13.0 (MPL-2.0 — test-only, unmodified).

**Banned by policy and absent from the tree:** server frameworks (express,
fastify, koa, hono, next), auth/cloud SDKs (firebase, supabase, aws-sdk),
analytics/telemetry (@sentry/*, posthog, segment, mixpanel, amplitude) and model
SDKs (openai, @anthropic-ai/*, @google-ai/*). `pnpm audit:licenses` re-verifies
this on every run; `eslint.config.mjs` bans the imports in source.

## Security and maintenance findings (`pnpm audit`, 2026-09-20)

`pnpm audit` reports **2 high, 1 moderate** — all in export transitives:

1. **`image-size ≤2.0.2` (high, ×2)** via `pptxgenjs@4.0.1`
   ([GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr),
   [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)):
   infinite-loop DoS in ICNS/JXL/HEIF image parsers. image-size only runs on
   image data embedded into a deck; the v1 export model embeds **no
   user-supplied images**, so the vulnerable parsers are believed unreachable
   from attacker input — *inference, pending A14/A16 confirmation that
   ExportModel can never carry user image bytes*. Flagged for L00: upgrading
   image-size past 2.x changes pptxgenjs behavior and is an owner decision, not
   a bootstrap override.
2. **`uuid <11.1.1` (moderate)** via `exceljs@4.4.0`
   ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)):
   missing buffer bounds check when the caller supplies `buf`. ExcelJS uses
   `uuid.v4()` without a caller buffer for document IDs — believed not
   reachable in the exploitable form — *inference; confirm during the A15
   export-gate review*.
3. **`buffers@0.1.1` — undeclared license** (via exceljs → unzipper): upstream
   ships no license field; pre-SPDX package. Recorded as a documented exception
   in `audit-licenses`; recommend review/replacement during the export gate.
4. **SheetJS advisories:** Snyk's prototype-pollution flag on `xlsx`
   (SNYK-JS-XLSX-5457926) was resolved in 0.19.3 and does not apply to the
   vendored 0.20.3; npm's own audit cannot score the vendored tarball — the
   SHA-256 pin in `vendor/README.md` is the integrity control.
5. **Maintenance age note:** `exceljs@4.4.0` (2023-10) is the planning-approved
   old-stable baseline; its transitive stack (`unzipper`, `archiver`, `tmp`,
   `big-integer`) is dated. Accepted per `research/DEPENDENCIES.md` pending the
   reachable-vulnerability review at the export gate — not waived.
6. **Transitive recency exception:** `framer-motion@13.4.0` (published
   2026-09-16) resolves as `motion@13.2.0`'s peer — outside direct-pin control;
   recorded for awareness.

No known critical vulnerabilities. Re-run `pnpm audit` at every upgrade PR.

## Worker-compatibility spike (verified, not assumed)

`pnpm spike:workers` builds a module worker importing `exceljs@4.4.0` +
`pptxgenjs@4.0.1` with the production Vite 8 toolchain, asserts the emitted
chunks carry no `eval`/`new Function`/`importScripts()`/`blob:`/`data:`/remote
imports, then — with a Chrome binary — runs the worker under the production
CSP (`script-src 'self'`, `worker-src 'self'`) and receives real ZIP artifacts
(XLSX 6,394 B / PPTX 44,738 B, both `PK\x03\x04`) over transferred
ArrayBuffers. Verified in Chrome for Testing 137 on this branch. Office/desktop
rendering of generated files remains a pending release gate, not claimed here.

## Ownership transfer (per 20_REPO_STRUCTURE.md)

A00 owns workspace scaffolding, package manifests, the lockfile, tsconfig, lint
configuration and the initial CI skeleton **until this bootstrap merges**. After
merge, **L00 owns all root configuration and dependency updates**; other agents
request dependency or root-config changes in their PR descriptions — they must
not edit `pnpm-lock.yaml` or package manifests directly. Regenerate
`dependency-inventory.json` / `THIRD_PARTY_NOTICES.md` in the same PR as any
dependency change.
