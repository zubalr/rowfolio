# @rowfolio/charts

Art-directed, evidence-ready charts. React owns the DOM; selective D3
(`d3-scale`, `d3-shape`, `d3-array`) supplies geometry only. Every component
consumes the immutable contract `ChartSpec` (contracts v1.0.0) — canonical
decimal values, declared domain, point keys and label/provenance IDs. The
package never recomputes business metrics; the only derived numbers are
display deltas (variance, scenario change) computed through the contract's
exact decimal arithmetic.

## Public surface

- `ChartFigure` — one component for every `kind` (`target-bars`, `line`,
  `bars`, `quality-bars`, `scenario-bars`, `distribution`). Renders title,
  text summary, keyboard datum explorer, tooltip and the "View values"
  evidence-table toggle.
- `ChartValuesTable` — the standalone table pattern (exact parity with the
  plotted spec values, variance/delta columns where the spec demands them,
  metric/provenance IDs as LTR mono islands).
- `prepareChart` — the pure model step (validation + domain/tick resolution),
  exported for tests and adapters.
- `ChartError` — typed errors (`invalid-domain`, `invalid-decimal`,
  `invalid-spec`, `unknown-series`, `empty-points`).

## Localization seam

The package imports no i18n implementation. Callers pass
`ChartLocalization` — `{ t, direction, formatters }` — which
`@rowfolio/i18n`'s `I18n` satisfies structurally (wrap `i18n.t` once if the
app's key type is narrower than `string`). Plot geometry is always LTR
(chronological axes included); `direction` governs text alignment and
surrounding composition only.

```tsx
import { ChartFigure } from "@rowfolio/charts";

<ChartFigure spec={chartSpec} localization={i18n} emphasisKey={findingKey} />;
```

## Invariants honored here

- Zero baseline for all bar kinds; declared domain is never silently
  narrowed — an extreme value widens the display domain instead of clipping.
- Straight line segments only; missing points break the line rather than
  interpolating.
- One roving keyboard control per chart (toolbar button + datum explorer);
  tooltip opens on focus/pointer and dismisses on Escape.
- `prefers-reduced-motion` removes transitions; state changes still render.
- Non-color encoding: dashed target/scenario strokes, hatch fill, direct
  value labels and sign-colored deltas — never color alone.
- Values cross the boundary as canonical decimals; Numbers exist only as
  pixel coordinates.

## Development

```sh
pnpm --filter @rowfolio/charts typecheck
pnpm exec vitest run packages/charts/src
pnpm --filter @rowfolio/charts gallery:dev   # local fixture gallery
pnpm exec playwright test --config tests/visual/charts/playwright.config.ts
```
