# @rowfolio/ui

Art-directed, direction-aware UI primitives for Rowfolio. One light theme on
the paper/ink/cobalt token system, with a scoped dark evidence surface.

## Using the package

```ts
import "@rowfolio/ui/fonts"; // once per app entry — IBM Plex (OFL-1.1)
import { Button, Field, Section, Dialog, Status, DataTable, Metric, MetricStrip } from "@rowfolio/ui";
```

`import "@rowfolio/ui"` alone loads the foundation CSS (tokens, base, component
styles) and exports every primitive. Components are **presentation-only**:
they take localized strings, pre-formatted values and contract types through
props, and never recompute business truth. Number formatting, locale catalogs
and analysis results belong to `@rowfolio/i18n`, `@rowfolio/analysis` and
friends.

## What's inside

| Primitive | Contract |
| --- | --- |
| `Button` | `primary` / `secondary` / `attention` (sparing); icon-only requires `label`; 44px targets |
| `Field` | real `<label htmlFor>`, help/error via `aria-describedby`, `aria-invalid`, LTR unit island |
| `Section` | divider-led hierarchy: eyebrow + title + meta + actions |
| `Dialog` | native `<dialog>`; heading takes initial focus; Tab containment; Esc/close single path; focus restore; `placement="drawer"` + `surface="ink"` = end-anchored dark evidence panel |
| `Status` | `loading`/`success`/`warning`/`error`/`info`/`empty`; `role="alert"` only for blocking errors; stage checklists |
| `DataTable` | sticky headers, visible one-based `R#` source rows (LTR islands), labelled scroll region, paged "show more" (default 50/page) |
| `Metric` / `MetricStrip` | unit-aware KPI; undefined metrics require `reasonLabel`; deltas carry sentiment + srDirection |
| `Bidi`, `VisuallyHidden`, `SkipLink` | direction isolation islands, skip navigation |
| `tokens`, `contrastRatio`, `directionOf` | typed design tokens + WCAG math used by the visual suite |

## Story/fixture gallery

`pnpm --filter @rowfolio/ui gallery:dev` (or `gallery:build` + `gallery:preview`)
serves the matrix at `http://localhost:4531/?lang=en|ar`. The gallery is the
fixture corpus for `tests/visual/ui` (Playwright: contrast, keyboard/focus,
axe, 320px, zoom, reduced-motion, EN/AR screenshots).

## Design tokens

`packages/ui/src/tokens.ts` mirrors `contracts/design-tokens.json` (contract
v1.0.0); `src/contrast.ts` reproduces `validation/contrast.json` and adds the
derived on-ink tint ramps used by the evidence surface. Logical CSS properties
throughout; `dir`-driven mirroring only for explicitly directional icons.
