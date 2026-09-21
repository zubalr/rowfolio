---
name: testing-rowfolio-deploy
description: How to smoke-test a deployed Rowfolio static dist (landing → sample workspace → export workers → AR routes) including coordinate mapping for clicks and worker-spawn verification.
---

# Testing Rowfolio deployed builds

Applies to smoke-checking a deployed `apps/web` dist (e.g. `*.devinapps.com`). Repo: `zubalr/rowfolio`, web app under `apps/web`.

## Golden path (real workers, real bytes)
1. Landing `/` — "Try the live demo" (`data-testid="cta-demo"`) only **reveals the landing preview** and stashes a one-shot `WorkspaceIntent` (`src/landing/pendingUpload.ts`). It does NOT navigate.
2. Navigate to `#/workspace` (address bar; hash route, no server route). `WorkspaceScreen` mount consumes the intent → `controller.useSample()` → fetch `/sample/index.json` + `/sample/sample_operations.xlsx` → ingest/profile/analyze inside `new Worker('/assets/analysis.worker-*.js', {type:'module'})` → `ready` phase (KpiStrip, FindingList, "Prepare briefing" `export-prepare-btn`).
   - Alternative: on the workspace idle screen, "Try the live demo" (`open-demo-cta`) calls `useSample()` directly.
3. "Prepare briefing" → `openExport()` + `prepareExport()` → `export.worker-*.js` builds xlsx then pptx → ExportDialog lists links "Save Excel workbook"/"Save PowerPoint briefing" as `blob:` URLs with `filename · N B · sha256`. Clicking downloads real files — verify on disk: size matches dialog exactly, `file` reports `Microsoft Excel 2007+`/`Zip archive`, `PK\x03\x04` magic.

## Verifying module workers spawn
Worker loads are `new Worker(new URL(...), {type:'module'})` — same-origin. To capture URLs deterministically, BEFORE triggering the flow, patch in DevTools console:
`window.__w=[];const _W=window.Worker;window.Worker=function(u,o){__w.push(String(u));return new _W(u,o)}`
Then read `__w`. Worker script fetches also appear in `performance.getEntriesByType('resource')` and the DevTools Network/Sources trees.

## AR routes
- `/` and `/ar/` both serve the **EN shell** on a plain static host (SPA fallback); `/ar/index.html` serves the real AR shell (`lang="ar" dir="rtl"`).
- Boot locale comes from `document.documentElement.lang` of the served shell (`services.ts` `bootLocale`); the `pathname.startsWith('/ar')` check (`App.tsx`) only runs on `popstate`, NOT initial load — so a deep link to `/ar/` may render English. Check `document.documentElement.lang/dir` live.
- `persistLocaleChoice` stores a pref on language-toggle click which can mask this on repeat visits — clear localStorage or use a fresh profile when checking the deep-link case.

## devinapps static host quirks
- `dist/_headers` (CSP incl. `worker-src 'self'`, `Cache-Control: immutable` for `/assets/*`) is NOT applied by the host — it's even served as a static file. Verify with `curl -sSI`, don't assume.
- All missing paths — including `/assets/*.js` — return `200 text/html` SPA fallback, never 404. A missing hashed asset serves HTML (breaks modules via MIME mismatch rather than a clean failure).

## Computer-use coordinate mapping (this box)
Real display 1600×1200, screenshots 1024×768 → scale 0.64. Chrome window is full-width at (0,0), height 1156; browser chrome ≈139 real px tall. Map CSS→screenshot: `sx = css_x*0.64`, `sy = (css_y + 139)*0.64`. Verify with `document.querySelector(sel).getBoundingClientRect()` before clicking — do NOT eyeball from the scaled screenshot.

## Pitfalls
- `browser_console`/CDP may attach to a stray New Tab **window** (separate window, not tab). Check `wmctrl -l` and `wmctrl -c "New Tab - Google Chrome"` to remove it.
- Escape toggles the DevTools console drawer — typing while it's closed goes nowhere.
- In the DevTools console, your own eval errors show as red entries — distinguish them from app errors.

## Devin secrets needed
None.
