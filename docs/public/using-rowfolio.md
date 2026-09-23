# Using Rowfolio

Practical guide to running the application locally and understanding what it
does with your numbers. Every statement here reflects the code in this
repository; commands were verified on a clean build.

## Running the application

Requirements: Node.js ≥ 22.12 and pnpm 12.

```sh
pnpm install --frozen-lockfile
pnpm build          # production build into apps/web/dist
pnpm preview        # serve the built app locally
```

`pnpm dev` starts a development server for iterative work. The built
application is a static site (English entry at `/`, Arabic at `/ar/`); it can
be served by any static file server. There is no backend: after the app
loads, nothing about your spreadsheet leaves the browser.

## What you can bring

- UTF-8 CSV or unencrypted `.xlsx`, up to 10 MiB compressed, 50,000 rows
  including header, 100 columns and 500,000 non-empty cells. Details and the
  full guardrail list: [supported-formats.md](supported-formats.md).
- **The sample** is a bundled synthetic dataset (a fictional regional service
  operation, March–June 2026) available one click from the landing page. It
  has a trusted manifest, so the analysis can treat revenue, targets, costs
  and downtime as confirmed business measures and produce the canonical
  findings.
- **Your own uploads** start without confirmed semantics. A CSV drops
  straight into a descriptive analysis: counts and distributions only, with
  the explicit note that business meaning has not been confirmed. Workbooks
  go through a staged review first — confirm the table and header row, then
  review proposed cleanup (duplicate rows, category variants, date order)
  before anything is analyzed. Nothing is imputed: blanks stay missing.

## Reading the evidence

Every finding carries "Show me why". Opening it shows the exact operands
(actual and target values), the calculation written out
(`(1,000,000 − 881,000) / 1,000,000 = 11.9%`), the exact source rows that
produced it (for the sample: `Operations!R1802:R1901`), and a SHA-256
fingerprint of the source file. The label says precisely what the fingerprint
does and does not mean: it identifies file bytes; it does not authenticate
the business data.

## Observed values versus scenario assumptions

"Test one assumption" changes exactly one thing — operating costs — across a
scope you can see (sample default: all regions, the latest period). Observed
numbers never move: the scenario row states the baseline contribution margin,
the scenario margin and the change in percentage points (at +8% on the
sample: 25% → 19%, a −6 point change). It is a mechanical sensitivity
calculation, not a forecast, and it never rewrites your data.

## Contribution is not net profit

Contribution means revenue minus the selected operating costs — nothing
more. It excludes unspecified other income, other costs and taxes, so it is
not an audited or statutory profit figure. The interface and exports keep
this wording instead of presenting a profit claim.

## Formula handling

Spreadsheet formulas are never evaluated. A formula cell keeps its formula
text and, if the workbook stored one, its cached result — used only when you
explicitly opt in, with a warning that caches may be stale. Missing cached
values stay missing. Text that merely looks like a formula (`=SUM(A1:A2)` in
a CSV cell, say) is inert text and is never executed or exported as a
formula.

## Export limitations

"Prepare briefing" generates two files in your browser: an Excel workbook
(executive summary, cleaned data with source row references, data quality,
KPI analysis, methodology) and a PowerPoint briefing, in the session
language. Each is listed with its size and a SHA-256 prefix before saving.
Two honest limits: the preview describes the briefing model, not a
pixel-exact PowerPoint render, and generated files have not been certified
against every Office version — open them in your target environment before
relying on formatting.

## Data lifecycle

An analysis session lives in memory. "Clear session", closing the tab or
reloading ends it; the next session starts empty. Only an interface
preference (language) is persisted. Uploaded contents never enter local
storage, URLs or logs, and exported files are not modified after download.
Details: [privacy.md](privacy.md).
