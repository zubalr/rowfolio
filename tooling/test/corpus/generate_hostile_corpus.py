#!/usr/bin/env python3
"""Deterministic hostile-input corpus generator for Rowfolio ingestion tests.

Writes bounded, synthetic, byte-reproducible CSV and minimal OOXML fixtures plus
per-case manifests with an independently authored expected semantic outcome and
a SHA-256 for every artifact. Content is a fixed set of literals: no random
number generation, no clocks, no environment lookups, so regenerating the
corpus anywhere produces identical bytes.

Boundaries enforced here and re-checked by validate_hostile_corpus.py:
  - total corpus < 20 MB
  - each CSV < 5,000 data rows (physical line count is an upper bound on
    records because quoted newlines can only add lines)
  - each OOXML package < 1 MB expanded, < 100 entries
  - no cell text >= 32,000 characters (mirrors the product input guardrail)

The expected outcomes in each manifest are authored alongside the literal
bytes, not derived from any production parser; production code is never used
as its own oracle. Archives use ZIP_STORED so artifact bytes do not depend on
the zlib build. This is a safe structural corpus: no zip bombs, no resource
exhaustion, no real personal or business data.

Usage: python3 generate_hostile_corpus.py [--out DIR]
Default output: <repo>/fixtures/hostile/generated/
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT = REPO_ROOT / "fixtures" / "hostile" / "generated"
GENERATOR_PATH = "tooling/test/corpus/generate_hostile_corpus.py"
CORPUS_VERSION = "1.0.0"

TOTAL_MAX_BYTES = 20 * 1024 * 1024
CSV_MAX_DATA_ROWS = 5000
XLSX_MAX_EXPANDED_BYTES = 1024 * 1024
XLSX_MAX_ENTRIES = 100
CELL_TEXT_MAX_CHARS = 32000

BOUNDS = {
    "totalMaxBytes": TOTAL_MAX_BYTES,
    "csvMaxDataRows": CSV_MAX_DATA_ROWS,
    "xlsxMaxExpandedBytes": XLSX_MAX_EXPANDED_BYTES,
    "xlsxMaxEntries": XLSX_MAX_ENTRIES,
    "cellTextMaxChars": CELL_TEXT_MAX_CHARS,
}


def _csv_bytes(rows: list[list[str]], lineterminator: str = "\n") -> bytes:
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator=lineterminator, quoting=csv.QUOTE_MINIMAL)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def _cell_ref(col: int, row: int) -> str:
    letters = ""
    c = col
    while c > 0:
        c, rem = divmod(c - 1, 26)
        letters = chr(ord("A") + rem) + letters
    return f"{letters}{row}"


def _sheet_xml(rows: list[list[tuple[str, str]]]) -> bytes:
    """rows: list of rows; each cell is (kind, value) with kind in
    {'s','n'} — 's' renders an inline string, 'n' a numeric cell. An empty
    list renders an empty sheetData."""
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        "<sheetData>",
    ]
    for r_idx, row in enumerate(rows, start=1):
        cells = []
        for c_idx, (kind, value) in enumerate(row, start=1):
            ref = _cell_ref(c_idx, r_idx)
            if kind == "n":
                cells.append(f'<c r="{ref}" t="n"><v>{value}</v></c>')
            elif kind == "e":
                cells.append(f'<c r="{ref}"/>')
            else:
                cells.append(
                    f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{value}</t></is></c>'
                )
        parts.append(f'<row r="{r_idx}">' + "".join(cells) + "</row>")
    parts.append("</sheetData></worksheet>")
    return ("\n".join(parts) + "\n").encode("utf-8")


def _escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _xlsx_bytes(sheets: list[tuple[str, bytes]]) -> bytes:
    """sheets: list of (display name, sheet xml). Deterministic minimal OOXML
    package: fixed entry order, fixed timestamps, ZIP_STORED for byte
    reproducibility across zlib builds."""
    buf = io.BytesIO()
    count = len(sheets)
    sheet_tags = "".join(
        f'<sheet name="{_escape_xml(name)}" sheetId="{i}" r:id="rId{i}"/>'
        for i, (name, _) in enumerate(sheets, start=1)
    )
    sheet_rels = "".join(
        f'<Relationship Id="rId{i}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        f'Target="worksheets/sheet{i}.xml"/>'
        for i in range(1, count + 1)
    )
    styles_rel = (
        f'<Relationship Id="rId{count + 1}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
    )
    overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for i in range(1, count + 1)
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        f"{overrides}</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/></Relationships>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<sheets>{sheet_tags}</sheets></workbook>"
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f"{sheet_rels}{styles_rel}</Relationships>"
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
        '<borders count="1"><border/></borders>'
        '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
        '<cellXfs count="1"><xf/></cellXfs></styleSheet>'
    )
    entries: list[tuple[str, bytes]] = [("[Content_Types].xml", content_types.encode("utf-8"))]
    entries.append(("_rels/.rels", root_rels.encode("utf-8")))
    entries.append(("xl/workbook.xml", workbook.encode("utf-8")))
    entries.append(("xl/_rels/workbook.xml.rels", workbook_rels.encode("utf-8")))
    entries.append(("xl/styles.xml", styles.encode("utf-8")))
    for i, (_, xml) in enumerate(sheets, start=1):
        entries.append((f"xl/worksheets/sheet{i}.xml", xml))
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        for name, data in entries:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = 0
            info.external_attr = 0o600 << 16
            zf.writestr(info, data)
    return buf.getvalue()


def _check_cell_text(rows: list[list[str]]) -> None:
    for row in rows:
        for value in row:
            if len(value) >= CELL_TEXT_MAX_CHARS:
                raise ValueError(f"cell text exceeds {CELL_TEXT_MAX_CHARS} chars")


# ---------------------------------------------------------------------------
# CSV cases
# ---------------------------------------------------------------------------

def case_csv_quoted_basics() -> tuple[dict, bytes]:
    rows = [
        ["id", "note", "amount_usd", "day"],
        ["T-1", "Plain note", "10.50", "2026-01-05"],
        ["T-2", 'Comma, quote " and newline\nsecond line', "12.00", "2026-01-06"],
        ["T-3", "Trailing comma,", "9.75", "2026-01-07"],
        ["T-4", "Unquoted simple", "0.00", "2026-01-08"],
    ]
    _check_cell_text(rows)
    manifest = {
        "caseId": "csv-quoted-basics",
        "category": "csv_quoting_newlines",
        "description": "RFC 4180 quoting: embedded comma, escaped double quote, embedded LF inside a quoted cell.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 4, "headerColumns": 4, "perRecordFieldCounts": [4, 4, 4, 4]},
            "parsedRows": [
                ["id", "note", "amount_usd", "day"],
                ["T-1", "Plain note", "10.50", "2026-01-05"],
                ["T-2", 'Comma, quote " and newline\nsecond line', "12.00", "2026-01-06"],
                ["T-3", "Trailing comma,", "9.75", "2026-01-07"],
                ["T-4", "Unquoted simple", "0.00", "2026-01-08"],
            ],
            "requiredBehavior": [
                "record T-2 spans two physical lines; logical record count is 4",
                "physical line count (5) exceeds logical record count (4); provenance must record both",
            ],
        },
        "notes": ["Synthetic values; no real entity."],
    }
    return manifest, _csv_bytes(rows)


def case_csv_utf8_bom() -> tuple[dict, bytes]:
    body = _csv_bytes(
        [
            ["date", "city", "sales_eur"],
            ["2026-02-01", "München", "120.00"],
            ["2026-02-02", "Zürich", "98.50"],
            ["2026-02-03", "Málaga", "64.25"],
        ]
    )
    manifest = {
        "caseId": "csv-utf8-bom",
        "category": "csv_bom",
        "description": "UTF-8 BOM before the header row; first header name must not absorb the BOM.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 3, "headerColumns": 3, "perRecordFieldCounts": [3, 3, 3]},
            "firstThreeBytesHex": "efbbbf",
            "requiredBehavior": [
                "BOM stripped before header interpretation; first header is exactly 'date'",
                "UTF-8 decode without silent replacement; non-ASCII city names preserved",
            ],
        },
        "notes": ["Synthetic city names chosen for accented Latin coverage."],
    }
    return manifest, b"\xef\xbb\xbf" + body


def case_csv_crlf_line_endings() -> tuple[dict, bytes]:
    rows = [
        ["id", "label", "value"],
        ["C-1", "Line one\r\nLine two", "5"],
        ["C-2", 'a"b', "7"],
        ["C-3", "c,d", "11"],
    ]
    _check_cell_text(rows)
    manifest = {
        "caseId": "csv-crlf-line-endings",
        "category": "csv_quoting_newlines",
        "description": "CRLF record separators including an embedded CRLF inside a quoted cell.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 3, "headerColumns": 3, "perRecordFieldCounts": [3, 3, 3]},
            "parsedRows": [
                ["id", "label", "value"],
                ["C-1", "Line one\r\nLine two", "5"],
                ["C-2", 'a"b', "7"],
                ["C-3", "c,d", "11"],
            ],
            "requiredBehavior": [
                "CRLF between records and inside quoted cells both preserved as authored",
                "embedded newline must not terminate the logical record",
            ],
        },
        "notes": [],
    }
    return manifest, _csv_bytes(rows, lineterminator="\r\n")


def case_csv_duplicate_headers() -> tuple[dict, bytes]:
    rows = [
        ["date", "region", "revenue", "revenue"],
        ["2026-03-01", "Alpha", "100.00", "150.00"],
        ["2026-03-02", "Beta", "80.00", "90.00"],
        ["2026-03-03", "Alpha", "120.00", "110.00"],
    ]
    manifest = {
        "caseId": "csv-duplicate-headers",
        "category": "csv_headers",
        "description": "Two columns share the header name 'revenue' with different data.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 3, "headerColumns": 4, "perRecordFieldCounts": [4, 4, 4]},
            "duplicateHeaderNames": [{"name": "revenue", "positions": [3, 4]}],
            "requiredBehavior": [
                "duplicate headers receive stable ordinal IDs and visible disambiguated labels; object keys are never overwritten",
                "column 3 sums to 300.00 and column 4 to 350.00; a consumer must never combine them",
            ],
        },
        "notes": [],
    }
    return manifest, _csv_bytes(rows)


def case_csv_empty_and_blank_headers() -> tuple[dict, bytes]:
    rows = [
        ["id", "", " ", "amount"],
        ["A-1", "x", "1", "5.00"],
        ["A-2", "y", "1", "6.00"],
        ["A-3", "z", "1", "7.00"],
    ]
    manifest = {
        "caseId": "csv-empty-and-blank-headers",
        "category": "csv_headers",
        "description": "One truly empty header and one whitespace-only header in the same table.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 3, "headerColumns": 4, "perRecordFieldCounts": [4, 4, 4]},
            "requiredBehavior": [
                "position 2 (empty) and position 3 (single space) are two distinct unnamed columns",
                "no silent trim-merge; default labels distinguish positions until renamed",
            ],
        },
        "notes": [],
    }
    return manifest, _csv_bytes(rows)


def case_csv_ragged_short_rows() -> tuple[dict, bytes]:
    rows = [
        ["id", "name", "value", "flag"],
        ["R-1", "ok", "10", "yes"],
        ["R-2", "ok2", "20", "no"],
        ["R-3", "short", "30"],
        ["R-4", "tiny"],
    ]
    manifest = {
        "caseId": "csv-ragged-short-rows",
        "category": "csv_ragged",
        "description": "Records with fewer fields than the header row.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 4, "headerColumns": 4, "perRecordFieldCounts": [4, 4, 3, 2]},
            "requiredBehavior": [
                "records 3 and 4 are malformed against the header; absent trailing fields are absent, not empty strings",
                "malformed records are disclosed with per-record counts, never silently padded or dropped",
            ],
        },
        "notes": [],
    }
    return manifest, _csv_bytes(rows)


def case_csv_ragged_long_row() -> tuple[dict, bytes]:
    rows = [
        ["a", "b", "c"],
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9", "10", "11"],
    ]
    manifest = {
        "caseId": "csv-ragged-long-row",
        "category": "csv_ragged",
        "description": "One record carries two fields beyond the header count.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 3, "headerColumns": 3, "perRecordFieldCounts": [3, 3, 5]},
            "requiredBehavior": [
                "record 3 exceeds the header width and must not be silently truncated to 3 fields",
                "mapping review surfaces the extra fields before any analysis uses the table",
            ],
        },
        "notes": [],
    }
    return manifest, _csv_bytes(rows)


def case_csv_missing_optional_values() -> tuple[dict, bytes]:
    rows = [
        ["date", "region", "revenue_usd", "csat_score"],
        ["2026-04-01", "Meridian", "210.00", "80"],
        ["2026-04-01", "Harbor", "150.00", "91"],
        ["2026-04-02", "Meridian", "180.00", ""],
        ["2026-04-02", "Harbor", "205.00", "77"],
        ["2026-04-03", "Meridian", "195.00", "85"],
        ["2026-04-03", "Harbor", "160.00", ""],
    ]
    manifest = {
        "caseId": "csv-missing-optional-values",
        "category": "csv_missing_values",
        "description": "Optional integer score blank on two of six records.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 6, "headerColumns": 4, "perRecordFieldCounts": [4] * 6},
            "missingCells": [{"row": 3, "column": "csat_score"}, {"row": 6, "column": "csat_score"}],
            "requiredBehavior": [
                "blanks remain missing; no zero fill, no imputation",
                "csat_score is descriptive: never summed; revenue_usd aggregates are unaffected by csat blanks",
            ],
        },
        "notes": ["Regions and values are invented; format mirrors a generic service score."],
    }
    return manifest, _csv_bytes(rows)


def case_csv_missing_required_measure() -> tuple[dict, bytes]:
    rows = [
        ["date", "region", "amount_usd"],
        ["2026-05-01", "Northline", "120.00"],
        ["2026-05-01", "Southline", ""],
        ["2026-05-02", "Northline", "130.00"],
        ["2026-05-02", "Southline", ""],
        ["2026-05-03", "Northline", "110.00"],
    ]
    manifest = {
        "caseId": "csv-missing-required-measure",
        "category": "csv_missing_values",
        "description": "Additive measure blank on two of five records.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 5, "headerColumns": 3, "perRecordFieldCounts": [3] * 5},
            "missingCells": [
                {"row": 2, "column": "amount_usd"},
                {"row": 4, "column": "amount_usd"},
            ],
            "requiredBehavior": [
                "amount_usd aggregates include 3 of 5 rows; eligible/included/excluded counts disclosed (excluded=2)",
                "an empty cell is not zero and never becomes zero",
            ],
        },
        "notes": [],
    }
    return manifest, _csv_bytes(rows)


def case_csv_invalid_numeric_values() -> tuple[dict, bytes]:
    rows = [
        ["id", "value"],
        ["V-1", "100"],
        ["V-2", "abc"],
        ["V-3", "12.34.56"],
        ["V-4", "1e999"],
        ["V-5", "200"],
    ]
    manifest = {
        "caseId": "csv-invalid-numeric-values",
        "category": "csv_invalid_values",
        "description": "Non-numeric text, a doubly-dotted number and an out-of-range exponent in one numeric candidate column.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 5, "headerColumns": 2, "perRecordFieldCounts": [2] * 5},
            "invalidNumericCells": [
                {"row": 2, "column": "value", "raw": "abc"},
                {"row": 3, "column": "value", "raw": "12.34.56"},
                {"row": 4, "column": "value", "raw": "1e999"},
            ],
            "requiredBehavior": [
                "every failed cell is listed with coordinates; column inference succeeds for 2/5 = 0.40 < 0.95 so the column is not confidently numeric",
                "'1e999' is non-finite/out-of-range and is rejected, never converted to a float",
            ],
        },
        "notes": ["Tiny strings only; no resource-exhaustion payloads."],
    }
    return manifest, _csv_bytes(rows)


def case_csv_zero_and_negative_baselines() -> tuple[dict, bytes]:
    rows = [
        ["id", "metric", "previous", "current"],
        ["Z-1", "revenue_usd", "0", "500"],
        ["Z-2", "revenue_usd", "400", "0"],
        ["Z-3", "returns_count", "-40", "-10"],
        ["Z-4", "cost_usd", "250", "300"],
    ]
    manifest = {
        "caseId": "csv-zero-and-negative-baselines",
        "category": "csv_invalid_values",
        "description": "Zero and negative baselines that make naive percentage change misleading.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 4, "headerColumns": 4, "perRecordFieldCounts": [4] * 4},
            "requiredBehavior": [
                "Z-1: previous=0 makes relative change not_computable; copy reads 'from zero to 500', never 'infinite growth'",
                "Z-3: negative base reports absolute change with a warning, not a percentage",
                "Z-2: current=0 is a valid observation, not a missing value",
            ],
        },
        "notes": [],
    }
    return manifest, _csv_bytes(rows)


def case_csv_ambiguous_slash_dates() -> tuple[dict, bytes]:
    rows = [
        ["id", "observed_at", "value"],
        ["D-1", "01/02/2026", "10"],
        ["D-2", "03/04/2026", "20"],
        ["D-3", "13/05/2026", "30"],
        ["D-4", "2026-06-07", "40"],
    ]
    manifest = {
        "caseId": "csv-ambiguous-slash-dates",
        "category": "csv_numeric_date_ambiguity",
        "description": "Slash dates compatible with both day-first and month-first reading, plus one ISO row.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 4, "headerColumns": 3, "perRecordFieldCounts": [3] * 4},
            "requiredBehavior": [
                "D-1 and D-2 are day/month ambiguous; D-3 (day 13) is only valid day-first, but one discriminating row must not decide the column",
                "raw strings preserved until the user confirms date order; success-rate voting never picks '03/04/26'",
                "D-4 matches ISO date-only strictly with no timezone conversion",
            ],
        },
        "notes": [],
    }
    return manifest, _csv_bytes(rows)


def case_csv_numeric_separator_profiles() -> tuple[dict, bytes]:
    rows = [
        ["id", "amount_note"],
        ["S-1", "1,234.50"],
        ["S-2", "1.234,50"],
        ["S-3", "١٢٣٤٫٥٠"],
        ["S-4", "500.25"],
    ]
    manifest = {
        "caseId": "csv-numeric-separator-profiles",
        "category": "csv_numeric_date_ambiguity",
        "description": "One column mixing en-US grouping, European decimal-comma and Arabic-Indic digits.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 4, "headerColumns": 2, "perRecordFieldCounts": [2] * 4},
            "requiredBehavior": [
                "'1,234.50' and '1.234,50' need an explicit numeric-convention profile; without one they stay ambiguous, never silently combined",
                "S-3 uses Arabic-Indic digits (U+0660–U+066F) with the Arabic decimal separator U+066B and requires an explicit parser profile",
                "S-4 is plain decimal; a mixed column fails single-profile validation and is disclosed as partial",
            ],
        },
        "notes": ["Values are invented amounts of no real currency context."],
    }
    return manifest, _csv_bytes(rows)


def case_csv_leading_zero_identifiers() -> tuple[dict, bytes]:
    rows = [
        ["id", "label"],
        ["00123", "Alpha"],
        ["00456", "Beta"],
        ["012", "Omega"],
    ]
    manifest = {
        "caseId": "csv-leading-zero-identifiers",
        "category": "csv_numeric_date_ambiguity",
        "description": "Numeric-looking identifiers with significant leading zeros.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 3, "headerColumns": 2, "perRecordFieldCounts": [2] * 3},
            "requiredBehavior": [
                "identifiers stay text; '00123' is never coerced to 123",
                "text identifiers sort and compare lexicographically; provenance keeps raw strings",
            ],
        },
        "notes": [],
    }
    return manifest, _csv_bytes(rows)


def case_csv_formula_like_strings() -> tuple[dict, bytes]:
    rows = [
        ["id", "memo", "value"],
        ["F-1", "=SUM(A2:A3)", "10"],
        ["F-2", "+470011002233", "20"],
        ["F-3", "-status", "30"],
        ["F-4", "@risk_register", "40"],
    ]
    manifest = {
        "caseId": "csv-formula-like-strings",
        "category": "csv_formula_like_strings",
        "description": "Text cells beginning with =, +, - and @ in a CSV (inert data; no macros exist in CSV).",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 4, "headerColumns": 3, "perRecordFieldCounts": [3] * 4},
            "formulaLikeCells": [
                {"row": 1, "column": "memo", "raw": "=SUM(A2:A3)"},
                {"row": 2, "column": "memo", "raw": "+470011002233"},
                {"row": 3, "column": "memo", "raw": "-status"},
                {"row": 4, "column": "memo", "raw": "@risk_register"},
            ],
            "requiredBehavior": [
                "cells remain inert strings; never evaluated, interpolated into formulas, or turned into executable links",
                "if exported to OOXML they are written as string cells, never formula cells",
            ],
        },
        "notes": [
            "Values are synthetic and non-executable; files are inert CSV data.",
        ],
    }
    return manifest, _csv_bytes(rows)


def case_csv_unicode_rtl_category_names() -> tuple[dict, bytes]:
    nfd_note = "Cafe\u0301"
    rows = [
        ["order_id", "product_ar", "note_en", "qty"],
        ["O-1", "قرطاسية", "Café", "5"],
        ["O-2", "قرطاسية", nfd_note, "5"],
        ["O-3", "أدوات مكتبية", "Resumé", "2"],
    ]
    manifest = {
        "caseId": "csv-unicode-rtl-category-names",
        "category": "csv_unicode_rtl",
        "description": "Arabic RTL category names, Latin identifiers, and an NFC/NFD pair of the same visible word.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 3, "headerColumns": 4, "perRecordFieldCounts": [4] * 3},
            "normalizationPair": {
                "rows": [1, 2],
                "column": "note_en",
                "rawBytesDiffer": True,
                "nfcComparisonKeysEqual": True,
            },
            "requiredBehavior": [
                "values preserved as authored; source column names and category text are user content and never auto-translated",
                "NFC normalization is applied for comparison keys only; Arabic letters are never merged and diacritics never stripped",
                "RTL cells need directional isolation (dir=auto / bdi) at display time; Latin IDs stay LTR islands",
            ],
        },
        "notes": [
            "Data rows 1 and 2 hold the same visible word in NFC and NFD form respectively (e vs e + U+0301)."
        ],
    }
    return manifest, _csv_bytes(rows)


def case_csv_header_only() -> tuple[dict, bytes]:
    rows = [["id", "value"]]
    manifest = {
        "caseId": "csv-header-only",
        "category": "csv_headers",
        "description": "A well-formed table with a header and zero records.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 0, "headerColumns": 2, "perRecordFieldCounts": []},
            "requiredBehavior": [
                "valid table with no observations; descriptive-only output, no trend or comparison claims",
            ],
        },
        "notes": [],
    }
    return manifest, _csv_bytes(rows)


def case_csv_empty_file() -> tuple[dict, bytes]:
    manifest = {
        "caseId": "csv-empty-file",
        "category": "csv_headers",
        "description": "Zero-byte CSV file.",
        "mediaType": "text/csv",
        "expected": {
            "tableShape": {"records": 0, "headerColumns": 0, "perRecordFieldCounts": []},
            "requiredBehavior": [
                "no usable table: clear recoverable error explaining the supported shape; never an unhandled exception",
            ],
        },
        "notes": [],
    }
    return manifest, b""


# ---------------------------------------------------------------------------
# OOXML cases
# ---------------------------------------------------------------------------

def _ops_sheet_rows() -> list[list[tuple[str, str]]]:
    return [
        [("s", "operation_id"), ("s", "day"), ("s", "amount_eur")],
        [("s", "OP-1"), ("s", "2026-01-05"), ("n", "10.5")],
        [("s", "OP-2"), ("s", "2026-01-06"), ("n", "7.25")],
    ]


def case_xlsx_minimal_valid() -> tuple[dict, bytes]:
    manifest = {
        "caseId": "xlsx-minimal-valid",
        "category": "ooxml_structure",
        "description": "Minimal valid single-sheet workbook with inline strings and two numeric cells.",
        "mediaType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "expected": {
            "sheets": [
                {
                    "name": "Operations",
                    "headerPhysicalRow": 1,
                    "records": 2,
                    "header": ["operation_id", "day", "amount_eur"],
                    "rows": [["OP-1", "2026-01-05", "10.5"], ["OP-2", "2026-01-06", "7.25"]],
                }
            ],
            "requiredBehavior": [
                "dates here are authored strings; no workbook date-system conversion applies to them",
                "numbers are numeric cells; strings are inline strings, never formulas",
            ],
        },
        "notes": [],
    }
    return manifest, _xlsx_bytes([("Operations", _sheet_xml(_ops_sheet_rows()))])


def case_xlsx_empty_sheetdata() -> tuple[dict, bytes]:
    manifest = {
        "caseId": "xlsx-empty-sheetdata",
        "category": "ooxml_structure",
        "description": "Workbook with one named sheet whose sheetData is empty.",
        "mediaType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "expected": {
            "sheets": [{"name": "Blank", "headerPhysicalRow": None, "records": 0, "header": [], "rows": []}],
            "requiredBehavior": [
                "an existing but empty sheet is enumerated, not an error; selection UI offers other sheets",
                "no usable table on this sheet alone; no fabricated header inference",
            ],
        },
        "notes": [],
    }
    return manifest, _xlsx_bytes([("Blank", _sheet_xml([]))])


def case_xlsx_header_on_row_2() -> tuple[dict, bytes]:
    rows = [
        [],
        [("s", "id"), ("s", "val")],
        [("s", "K-1"), ("n", "5")],
        [("s", "K-2"), ("n", "6")],
    ]
    manifest = {
        "caseId": "xlsx-header-on-row-2",
        "category": "ooxml_structure",
        "description": "Header row on physical worksheet row 2; physical row 1 is empty.",
        "mediaType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "expected": {
            "sheets": [
                {
                    "name": "Offset",
                    "headerPhysicalRow": 2,
                    "records": 2,
                    "header": ["id", "val"],
                    "rows": [["K-1", "5"], ["K-2", "6"]],
                }
            ],
            "requiredBehavior": [
                "table bounds start below row 1; physical 1-based coordinates are preserved for provenance (data rows 3–4)",
                "row 1 emptiness is not silently discarded from source coordinates",
            ],
        },
        "notes": [],
    }
    return manifest, _xlsx_bytes([("Offset", _sheet_xml(rows))])


def case_xlsx_duplicate_sheet_names() -> tuple[dict, bytes]:
    sheet_a = _sheet_xml(
        [
            [("s", "id"), ("s", "val")],
            [("s", "S-1"), ("n", "1")],
        ]
    )
    sheet_b = _sheet_xml(
        [
            [("s", "k"), ("s", "v")],
            [("s", "alpha"), ("n", "2")],
        ]
    )
    manifest = {
        "caseId": "xlsx-duplicate-sheet-names",
        "category": "ooxml_structure",
        "description": "Two worksheet parts with the identical display name 'Data'.",
        "mediaType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "expected": {
            "sheets": [
                {
                    "name": "Data",
                    "sheetPart": "xl/worksheets/sheet1.xml",
                    "headerPhysicalRow": 1,
                    "records": 1,
                    "header": ["id", "val"],
                    "rows": [["S-1", "1"]],
                },
                {
                    "name": "Data",
                    "sheetPart": "xl/worksheets/sheet2.xml",
                    "headerPhysicalRow": 1,
                    "records": 1,
                    "header": ["k", "v"],
                    "rows": [["alpha", "2"]],
                },
            ],
            "requiredBehavior": [
                "both parts enumerated with stable sheet ordinals; identical display names never merged or deduplicated",
                "selection identifies sheets by part/ordinal, not display name alone",
            ],
        },
        "notes": [],
    }
    return manifest, _xlsx_bytes([("Data", sheet_a), ("Data", sheet_b)])


def case_xlsx_ragged_trailing_empty_cells() -> tuple[dict, bytes]:
    rows = [
        [("s", "a"), ("s", "b"), ("s", "c")],
        [("n", "1"), ("n", "2"), ("n", "3")],
        [("n", "4"), ("n", "5"), ("n", "6"), ("e", ""), ("e", "")],
        [("n", "7")],
    ]
    manifest = {
        "caseId": "xlsx-ragged-trailing-empty-cells",
        "category": "ooxml_structure",
        "description": "Rows with differing physical widths including present-but-empty cell elements.",
        "mediaType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "expected": {
            "sheets": [
                {
                    "name": "Ragged",
                    "headerPhysicalRow": 1,
                    "records": 3,
                    "header": ["a", "b", "c"],
                    "rows": [["1", "2", "3"], ["4", "5", "6", "", ""], ["7"]],
                }
            ],
            "requiredBehavior": [
                "an empty <c/> element contributes no value; record 2 has physical width 5 with two absent values",
                "row widths disclosed per record; no silent padding to the header width",
            ],
        },
        "notes": [],
    }
    return manifest, _xlsx_bytes([("Ragged", _sheet_xml(rows))])


def case_xlsx_formula_like_strings() -> tuple[dict, bytes]:
    rows = [
        [("s", "id"), ("s", "memo"), ("n", "value")],
        [("s", "F-1"), ("s", "=SUM(B2:B3)"), ("n", "10")],
        [("s", "F-2"), ("s", "+470011002233"), ("n", "20")],
        [("s", "F-3"), ("s", "-status"), ("n", "30")],
        [("s", "F-4"), ("s", "@risk_register"), ("n", "40")],
    ]
    manifest = {
        "caseId": "xlsx-formula-like-strings",
        "category": "ooxml_structure",
        "description": "Inline string cells beginning with =, +, - and @ inside a workbook (no formula cells exist in this package).",
        "mediaType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "expected": {
            "sheets": [
                {
                    "name": "Notes",
                    "headerPhysicalRow": 1,
                    "records": 4,
                    "header": ["id", "memo", "value"],
                    "rows": [
                        ["F-1", "=SUM(B2:B3)", "10"],
                        ["F-2", "+470011002233", "20"],
                        ["F-3", "-status", "30"],
                        ["F-4", "@risk_register", "40"],
                    ],
                }
            ],
            "requiredBehavior": [
                "every memo cell is a string cell (inline string): type text, never type formula, formula null",
                "values are never evaluated or interpolated into formula syntax; export writes them as OOXML string cells",
                "the numeric column stays numeric and unaffected by the memo strings",
            ],
        },
        "notes": [
            "Complements csv-formula-like-strings on the spreadsheet side; inert data, no macros, no real formula parts.",
        ],
    }
    return manifest, _xlsx_bytes([("Notes", _sheet_xml(rows))])


# ---------------------------------------------------------------------------
# Corpus assembly
# ---------------------------------------------------------------------------

CSV_CASES = [
    case_csv_quoted_basics,
    case_csv_utf8_bom,
    case_csv_crlf_line_endings,
    case_csv_duplicate_headers,
    case_csv_empty_and_blank_headers,
    case_csv_ragged_short_rows,
    case_csv_ragged_long_row,
    case_csv_missing_optional_values,
    case_csv_missing_required_measure,
    case_csv_invalid_numeric_values,
    case_csv_zero_and_negative_baselines,
    case_csv_ambiguous_slash_dates,
    case_csv_numeric_separator_profiles,
    case_csv_leading_zero_identifiers,
    case_csv_formula_like_strings,
    case_csv_unicode_rtl_category_names,
    case_csv_header_only,
    case_csv_empty_file,
]

XLSX_CASES = [
    case_xlsx_minimal_valid,
    case_xlsx_empty_sheetdata,
    case_xlsx_header_on_row_2,
    case_xlsx_duplicate_sheet_names,
    case_xlsx_ragged_trailing_empty_cells,
    case_xlsx_formula_like_strings,
]


def build_corpus() -> dict:
    """Build all case artifacts and manifests in memory.

    Returns {"cases": [case dicts with artifact bytes], "index": index dict}.
    """
    cases = []
    total_bytes = 0
    for builder in CSV_CASES + XLSX_CASES:
        manifest, artifact = builder()
        ext = ".csv" if manifest["mediaType"] == "text/csv" else ".xlsx"
        filename = manifest["caseId"] + ext
        sha = hashlib.sha256(artifact).hexdigest()
        size = len(artifact)
        total_bytes += size
        if manifest["mediaType"] == "text/csv":
            data_rows = 0 if len(artifact) == 0 else artifact.count(b"\n") - 1
            if data_rows >= CSV_MAX_DATA_ROWS:
                raise ValueError(f"{manifest['caseId']}: CSV rows {data_rows} exceed bound")
            if size > TOTAL_MAX_BYTES:
                raise ValueError(f"{manifest['caseId']}: artifact exceeds total byte bound")
        else:
            with zipfile.ZipFile(io.BytesIO(artifact)) as zf:
                entries = len(zf.infolist())
                expanded = sum(i.file_size for i in zf.infolist())
            if entries >= XLSX_MAX_ENTRIES:
                raise ValueError(f"{manifest['caseId']}: entry count {entries} exceeds bound")
            if expanded >= XLSX_MAX_EXPANDED_BYTES:
                raise ValueError(f"{manifest['caseId']}: expanded size {expanded} exceeds bound")
        case = {
            "manifest": manifest,
            "filename": filename,
            "bytes": size,
            "sha256": sha,
            "artifact": artifact,
        }
        cases.append(case)

    if total_bytes >= TOTAL_MAX_BYTES:
        raise ValueError(f"corpus total {total_bytes} exceeds bound {TOTAL_MAX_BYTES}")

    index = {
        "schemaVersion": CORPUS_VERSION,
        "kind": "rowfolio-hostile-corpus-index",
        "generator": GENERATOR_PATH,
        "bounds": BOUNDS,
        "totals": {"cases": len(cases), "bytes": total_bytes},
        "cases": [
            {"caseId": c["manifest"]["caseId"], "artifact": c["filename"], "sha256": c["sha256"], "bytes": c["bytes"]}
            for c in cases
        ],
    }
    return {"cases": cases, "index": index}


def write_corpus(out_dir: Path) -> dict:
    built = build_corpus()
    out_dir.mkdir(parents=True, exist_ok=True)
    for case in built["cases"]:
        (out_dir / case["filename"]).write_bytes(case["artifact"])
        manifest = dict(case["manifest"])
        manifest["artifact"] = case["filename"]
        manifest["sha256"] = case["sha256"]
        manifest["bytes"] = case["bytes"]
        manifest["generator"] = GENERATOR_PATH
        manifest["corpusVersion"] = CORPUS_VERSION
        manifest_path = out_dir / f"{case['manifest']['caseId']}.manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_dir / "corpus-index.json").write_text(
        json.dumps(built["index"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return built


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output directory")
    args = parser.parse_args()
    built = write_corpus(args.out)
    print(f"wrote {built['index']['totals']['cases']} cases, {built['index']['totals']['bytes']} bytes to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
