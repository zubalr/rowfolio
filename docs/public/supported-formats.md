# Supported formats and input limits

**Status: specification.** Ingestion is being implemented against the
versioned contracts; the bounds below are enforced by the ingestion
implementation once it lands, and hostile fixtures exercising them are
already committed under `fixtures/hostile/generated/`.

## Input formats

| Format | Accepted |
| --- | --- |
| CSV, UTF-8 (with or without BOM) | Yes |
| XLSX, unencrypted | Yes |
| Legacy XLS, XLSB, XLSM, ODS, password-protected or macro-enabled packages | No |

File extensions and MIME types are treated as hints; the file content itself
is inspected. A CSV cell may hold at most 32,000 characters.

## Guardrails

| Limit | Value |
| --- | --- |
| Compressed file size | 10 MiB |
| Expanded XLSX package size | 100 MiB cumulative, 32 MiB per entry |
| XLSX package entries | 2,000 |
| Expansion ratio | 200:1 |
| Rows in the selected table | 50,000 including the header row |
| Columns | 100 |
| Non-empty cells | 500,000 |
| Visible sheets enumerated | 20 (extra sheets are listed as unsupported, not merged) |
| Parse watchdog | 15 seconds, warning at 5 seconds |

Files beyond these bounds are rejected with a clear explanation rather than
partially analyzed.

## What ingestion does with tricky input

The committed hostile corpus documents the intended handling of common edge
cases. Highlights:

- Blank cells are missing values, never zeros, and nothing is imputed.
- Duplicate column headers receive stable ordinal identifiers and visible
  disambiguated labels; they are never silently overwritten or merged.
- Slash-form dates (for example `03/04/2026`) stay ambiguous until you
  confirm the day/month order; row counts never vote an interpretation in.
- Numbers need a confirmed separator convention when ambiguous (`1,234.50`
  versus `1.234,50`); Arabic-Indic digits require an explicit digit profile.
- Values that merely look numeric, such as identifiers with leading zeros,
  remain text.
- Text beginning with `=`, `+`, `-` or `@` is inert data: it is never
  evaluated or written back as a spreadsheet formula.

## Outputs

The planned briefing outputs are a native `.xlsx` workbook (summary, cleaned
data with source row references, data quality, KPI analysis, methodology) and
a native, editable `.pptx` deck, in English or Arabic. Export packages are
being implemented; numeric cells stay numeric, values are decimal strings
until the export boundary, and formulas are never generated from your cell
text. The application does not modify your original file.

## Known limitations (by design)

- One table per analysis; no automatic joins across sheets.
- No formula evaluation: cached formula results are used only when you
  explicitly opt in, and are labeled as potentially stale.
- No forecasts. The cost scenario is a clearly labeled what-if on your own
  numbers, not a prediction.
- PDF export and arbitrary-format readers are out of scope.
