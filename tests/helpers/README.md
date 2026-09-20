# tests/helpers — shared test utilities + harness self-tests

Import from the barrel in new suites:

```ts
import {
  assertProperty, arbCanonicalDecimal, arbRowSpans, arbUnsafeCellText, arbIsoDate,
  guard, buildProgress, buildSuccess, buildError, expectFreshnessAgree, expectEnvelopeAgree,
  scanRequestsForEgress, installStaticAllowlist, collectRequests,
  shotMeta, shotsManifest, captureEvidenceShot,
  assertCatalogParity, assertManifestCoverage, loadCatalog,
  expectMetric, oracleDiffs, assertOracleFields, loadOracle, normalizeAgree,
  inspectHostileFixture, assertFindings, loadHostileManifest,
  REPO_ROOT, FIXTURES_HOSTILE, ARTIFACTS_DIR, gitHeadSha, loadJson, loadBytes,
} from './index.ts'; // adjust path for your suite depth
```

| Module | Provides |
| --- | --- |
| `repo.ts` | repo-root paths, fixture loaders, sha256, git HEAD |
| `property.ts` | `assertProperty` with seed resolution (`ROWFOLIO_FC_SEED`/`FC_SEED`/explicit) and JSONL failing-seed capture under `artifacts/`; bundled arbitraries |
| `transport.ts` | worker message builders + dual-oracle assertions (contract `classifyWorkerResponse`/`checkWorkerEnvelope` vs independent `tooling/test/envelope.ts`) |
| `native.ts` | `inspectBytes`/`inspectFile` bridge + `assertFindings`, manifest access |
| `network.ts` | pure egress scanner + Playwright request collector/static allowlist |
| `screenshot.ts` | evidence PNG sidecar metadata + sorted manifest + `captureEvidenceShot` |
| `i18n.ts` | catalog parity + contract key-manifest coverage assertions |
| `oracle.ts` | decimal normalize agreement + strict oracle field comparison |

The `*.test.ts` files here are the harness's own self-tests (planted
mutations must fail, fixtures stay inside the documented envelope,
seeds reproduce). Feature tests for other areas import these helpers
but live in their own directories.

`artifacts/` (failing seeds, screenshot output) is gitignored.
