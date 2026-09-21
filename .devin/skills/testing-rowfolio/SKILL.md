---
name: testing-rowfolio
description: How to set up, serve, and end-to-end test the Rowfolio web app (EN/AR, workspace upload flow, export artifacts, responsive/reduced-motion passes) including non-obvious tooling workarounds.
---

# Testing Rowfolio (apps/web)

## Setup
- `source ~/env.sh` → Node 24.x + pnpm 12.x. Repo at `~/repos/rowfolio`. `pnpm install --frozen-lockfile`.
- Full suite: `pnpm lint`, `pnpm typecheck`, `pnpm test` (vitest), `pnpm audit:static`, `pnpm audit:licenses`, `pnpm test:e2e` (playwright), `pnpm exec playwright test --config tests/visual/charts/playwright.config.ts`.

## Serving for recorded browser tests
- A detached static server serves `apps/web/dist` on `http://127.0.0.1:4173` with strict CSP headers.
- Routes: `/` (EN, `lang=en dir=ltr`), `/ar/` (AR, `lang=ar dir=rtl`), hash router `#/workspace`.
- Check `~/repos/rowfolio` worktrees for a running server before starting a new one (`ps aux | grep http.server` / port 4173).

## CDP emulation for mobile widths (key workaround)
Chrome on this box will NOT resize below ~500 CSS px window width. To test 390px/320px viewports on the LIVE recorded window, attach Playwright over the existing Chrome's CDP port and use `Emulation.setDeviceMetricsOverride`:
- Find the port: `ps aux | grep -o "remote-debugging-port=[0-9]*"`.
- `chromium.connectOverCDP('http://localhost:<port>')` → `ctx.pages()` → `ctx.newCDPSession(page)` → `session.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor:1, mobile: w<768})`.
- IMPORTANT: overrides are per-session and die when your script exits/disconnects. For `prefers-reduced-motion` (`Emulation.setEmulatedMedia`), keep the Node process alive in the background (`await new Promise(()=>{})`) while you interact via the computer tool/browser_console.
- playwright is not importable from /tmp — resolve via `createRequire('/home/ubuntu/repos/rowfolio/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/package.json')` + `require('playwright')`.
- Verify per width: `document.documentElement.scrollWidth > clientWidth` = horizontal-scroll defect.

## Verifying export artifacts
- CSP on the test server blocks `fetch(blob:...)` — do NOT try to fetch the blob in-page. Click the real download links in the export dialog; files land in `~/Downloads`.
- Verify with `unzip -l` (XLSX needs `[Content_Types].xml`, `xl/workbook.xml`, `xl/worksheets/*`; PPTX needs `ppt/presentation.xml`, `ppt/slides/slide*.xml`) and `sha256sum` — the first 12 hex chars must match the `sha256` shown in the dialog.

## Known-fragile areas (verify carefully, don't assume pass)
- Percent formatting groups by default: `formatPercent('12.3')` → `1,230%` (Intl grouping), not `1230%`. Locale catalog files (`packages/i18n/src/locales/{en,ar}.json`) are sha256-pinned by `tests/unit/i18n/catalog.test.ts` AND `tests/unit/i18n/generated/content-fixture.gen.ts` — any catalog copy edit must re-pin both.
- Fractional percentage-point paths have crashed the app twice via `formatInteger` on non-integer input — workspace submit path is fixed (routes to `formatNumber`); check `landing/PreviewStage.tsx` and any new display call sites for the same pattern.
- Cancel semantics: `request.cancelled` must be dispatched for the live `state.requestId` before `analysis.cancel`; superseded coroutines must not stamp new requestIds (rid guards after every await boundary in `controller.ts`).
- Responsive: watch `document.documentElement.scrollWidth > clientWidth` at 320–1024px — class collisions across `app.css`/`landing.css` (e.g. `.rf-finding`) and missing `min-width:0` on flex children caused real overflow.

## Useful selectors
`cta-demo`, `cta-upload`, `cta-guide`, `scenario-range` (`#rf-cost-range`), `preview-evidence`, `view-evidence-btn`, `export-prepare-btn`, `clear-session-btn`, `upload-dropzone`, `col-select-<id>`, `review-panel`, `evidence-dialog`.
