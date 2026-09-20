#!/usr/bin/env python3
"""Independent integrity/bounds validator for the hostile-input corpus.

This script is deliberately independent of the generator: it re-reads the
artifacts from disk, recomputes hashes, re-checks every declared bound, and —
with --structural — performs a light second-implementation read (csv module +
zipfile/ElementTree) of the coarse shape facts declared in each manifest.

It is NOT the semantic oracle for consumers: the `expected` blocks in the
manifests are the semantic contracts that a production ingest implementation
is tested against. This validator only proves the committed corpus is intact,
in bounds, and internally consistent with its manifests.

Usage:
  python3 validate_hostile_corpus.py [--dir DIR] [--structural] [--json]
Default dir: <repo>/fixtures/hostile/generated/
Exit code 0 = no issues, 1 = issues found.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from decimal import Decimal, localcontext
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DIR = REPO_ROOT / "fixtures" / "hostile" / "generated"

TOTAL_MAX_BYTES = 20 * 1024 * 1024
CSV_MAX_DATA_ROWS = 5000
XLSX_MAX_EXPANDED_BYTES = 1024 * 1024
XLSX_MAX_ENTRIES = 100
CELL_TEXT_MAX_CHARS = 32000

REQUIRED_MANIFEST_FIELDS = [
    "caseId",
    "category",
    "description",
    "artifact",
    "mediaType",
    "sha256",
    "bytes",
    "expected",
    "generator",
    "corpusVersion",
]

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _issue(case_id: str, check: str, detail: str) -> dict:
    return {"caseId": case_id, "check": check, "detail": detail}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_csv_rows(data: bytes) -> list[list[str]]:
    text = data.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text, newline=""))
    return list(reader)


def _structural_csv(case_id: str, manifest: dict, data: bytes, issues: list[dict]) -> None:
    expected = manifest["expected"]["tableShape"]
    try:
        rows = _read_csv_rows(data)
    except (UnicodeDecodeError, csv.Error) as exc:
        issues.append(_issue(case_id, "structural.csv", f"parse failed: {exc}"))
        return
    while rows and rows[-1] == []:
        rows.pop()
    if not rows:
        records = 0
        header_columns = 0
        counts: list[int] = []
    else:
        header, body = rows[0], rows[1:]
        header_columns = len(header)
        records = len(body)
        counts = [len(r) for r in body]
    if records != expected["records"]:
        issues.append(_issue(case_id, "structural.records", f"declared {expected['records']}, structural read {records}"))
    if header_columns != expected["headerColumns"]:
        issues.append(
            _issue(case_id, "structural.headerColumns", f"declared {expected['headerColumns']}, structural read {header_columns}")
        )
    if counts != expected["perRecordFieldCounts"]:
        issues.append(
            _issue(case_id, "structural.perRecordFieldCounts", f"declared {expected['perRecordFieldCounts']}, structural read {counts}")
        )
    exp_rows = manifest["expected"].get("parsedRows")
    if exp_rows is not None and rows != exp_rows:
        issues.append(_issue(case_id, "structural.parsedRows", "declared parsedRows do not match an independent csv read"))
    for miss in manifest["expected"].get("missingCells", []):
        r, col = miss["row"], miss["column"]
        rows_all = rows
        if r < 1 or r >= len(rows_all):
            issues.append(_issue(case_id, "structural.missingCell", f"row {r} out of range"))
            continue
        header = rows_all[0]
        if col not in header:
            issues.append(_issue(case_id, "structural.missingCell", f"column {col} not in header"))
            continue
        value = rows_all[r][header.index(col)] if len(rows_all[r]) > header.index(col) else None
        if value != "":
            issues.append(_issue(case_id, "structural.missingCell", f"row {r} col {col} declared missing but is {value!r}"))
    for bad in manifest["expected"].get("invalidNumericCells", []):
        r = bad["row"]
        if r < 1 or r >= len(rows) or bad["raw"] not in rows[r]:
            issues.append(_issue(case_id, "structural.invalidNumericCell", f"row {r} does not contain raw {bad['raw']!r}"))
    for flike in manifest["expected"].get("formulaLikeCells", []):
        r = flike["row"]
        if r < 1 or r >= len(rows) or flike["raw"] not in rows[r]:
            issues.append(_issue(case_id, "structural.formulaLikeCell", f"row {r} does not contain raw {flike['raw']!r}"))
    pair = manifest["expected"].get("normalizationPair")
    if pair:
        a, b = pair["rows"]
        col = pair["column"]
        header = rows[0]
        ci = header.index(col)
        va, vb = rows[a][ci], rows[b][ci]
        bytes_differ = va.encode("utf-8") != vb.encode("utf-8")
        if bytes_differ != pair["rawBytesDiffer"]:
            issues.append(_issue(case_id, "structural.normalizationPair", "rawBytesDiffer declaration disagrees with bytes"))
        if (unicodedata.normalize("NFC", va) == unicodedata.normalize("NFC", vb)) != pair["nfcComparisonKeysEqual"]:
            issues.append(_issue(case_id, "structural.normalizationPair", "nfcComparisonKeysEqual declaration disagrees"))


def _decimal_sum(values: list[str]) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = 60
        total = Decimal("0")
        for value in values:
            if value == "":
                continue  # blank cells are missing, not zero — sums skip them
            total += Decimal(value)
        return +total


def _exact_sums(case_id: str, manifest: dict, rows: list[list[str]], issues: list[dict]) -> None:
    """Recompute declared exact column sums with Decimal arithmetic."""
    header = rows[0] if rows else []
    for column, declared in (manifest["expected"].get("exactSums") or {}).items():
        if column not in header:
            issues.append(_issue(case_id, "structural.exactSums", f"column {column} not in header"))
            continue
        ci = header.index(column)
        values = [(r[ci] if len(r) > ci else "") for r in rows[1:]]
        try:
            total = _decimal_sum(values)
        except Exception as exc:  # noqa: BLE001 - report any arithmetic failure as an issue
            issues.append(_issue(case_id, "structural.exactSums", f"column {column}: {exc}"))
            continue
        if total != Decimal(declared):
            issues.append(
                _issue(case_id, "structural.exactSums", f"column {column}: declared {declared}, exact sum {total}")
            )
    grouped = manifest["expected"].get("exactSumsByGroup")
    if grouped:
        group_col = grouped.get("groupBy")
        sum_col = grouped.get("column")
        if group_col not in header or sum_col not in header:
            issues.append(_issue(case_id, "structural.exactSumsByGroup", "group or sum column not in header"))
            return
        gi, si = header.index(group_col), header.index(sum_col)
        totals: dict[str, Decimal] = {}
        for r in rows[1:]:
            key = r[gi] if len(r) > gi else ""
            value = r[si] if len(r) > si else ""
            if value == "":
                continue
            totals[key] = totals.get(key, Decimal("0")) + Decimal(value)
        for key, declared in (grouped.get("values") or {}).items():
            actual = totals.get(key)
            if actual is None:
                issues.append(_issue(case_id, "structural.exactSumsByGroup", f"group {key} absent"))
            elif actual != Decimal(declared):
                issues.append(
                    _issue(case_id, "structural.exactSumsByGroup", f"group {key}: declared {declared}, exact sum {actual}")
                )
        undeclared = sorted(set(totals) - set(grouped.get("values") or {}))
        if undeclared:
            issues.append(_issue(case_id, "structural.exactSumsByGroup", f"groups present but undeclared: {undeclared}"))


def _col_to_index(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n


def _read_xlsx_sheets(data: bytes) -> list[dict]:
    """Minimal second-implementation read: workbook part -> sheet parts, rows
    as lists of raw cell strings (inline strings and numeric <v> text)."""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = set(zf.namelist())
        ct = ET.fromstring(zf.read("[Content_Types].xml"))
        _ = ct  # content types assumed valid; structural depth kept minimal
        wb = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        rel_map = {}
        for rel in rels:
            rel_map[rel.get("Id")] = rel.get("Target")
        sheets = []
        for i, sheet in enumerate(wb.find(f"{{{NS_MAIN}}}sheets"), start=1):
            target = rel_map[sheet.get(f"{{{NS_REL_DOC}}}id")]
            if not target.startswith("xl/"):
                target = "xl/" + target.lstrip("/")
            part = target if target in names else target  # stored normalized above
            ws = ET.fromstring(zf.read(part))
            rows_out = []
            header_row = None
            sheet_data = ws.find(f"{{{NS_MAIN}}}sheetData")
            for row in (sheet_data if sheet_data is not None else []):
                cells = {}
                for c in row:
                    ref = c.get("r") or ""
                    idx = _col_to_index(ref) if ref else len(cells) + 1
                    t = c.get("t")
                    if t == "inlineStr":
                        is_el = c.find(f"{{{NS_MAIN}}}is")
                        text = "".join(t_el.text or "" for t_el in is_el.iter(f"{{{NS_MAIN}}}t"))
                        cells[idx] = text
                    else:
                        v = c.find(f"{{{NS_MAIN}}}v")
                        cells[idx] = v.text if v is not None else ""
                if cells:
                    width = max(cells)
                    rows_out.append([cells.get(j, "") for j in range(1, width + 1)])
                else:
                    rows_out.append([])
            non_empty = [r for r in rows_out if any(cell != "" for cell in r)]
            if non_empty:
                header_row = 1
                for j, r in enumerate(rows_out, start=1):
                    if any(cell != "" for cell in r):
                        header_row = j
                        break
            sheets.append(
                {
                    "name": sheet.get("name"),
                    "headerPhysicalRow": header_row,
                    "rows": non_empty,
                }
            )
        return sheets


def _structural_xlsx(case_id: str, manifest: dict, data: bytes, issues: list[dict]) -> None:
    try:
        sheets = _read_xlsx_sheets(data)
    except (zipfile.BadZipFile, ET.ParseError, KeyError) as exc:
        issues.append(_issue(case_id, "structural.xlsx", f"read failed: {exc}"))
        return
    expected = manifest["expected"]["sheets"]
    if len(sheets) != len(expected):
        issues.append(_issue(case_id, "structural.sheets", f"declared {len(expected)} sheets, read {len(sheets)}"))
        return
    for exp, got in zip(expected, sheets):
        if exp["name"] != got["name"]:
            issues.append(_issue(case_id, "structural.sheetName", f"{exp['name']!r} vs {got['name']!r}"))
        if (exp["headerPhysicalRow"]) != got["headerPhysicalRow"]:
            issues.append(
                _issue(case_id, "structural.headerPhysicalRow", f"{exp['name']}: declared {exp['headerPhysicalRow']}, read {got['headerPhysicalRow']}")
            )
        header = got["rows"][0] if got["rows"] else []
        records = max(len(got["rows"]) - 1, 0) if got["rows"] else 0
        if header != exp["header"]:
            issues.append(_issue(case_id, "structural.header", f"{exp['name']}: declared {exp['header']}, read {header}"))
        if records != exp["records"]:
            issues.append(_issue(case_id, "structural.records", f"{exp['name']}: declared {exp['records']} records, read {records}"))
        for declared, read_row in zip(exp["rows"], got["rows"][1:]):
            trimmed = [cell for cell in read_row]
            if trimmed != declared:
                issues.append(_issue(case_id, "structural.rows", f"{exp['name']}: declared {declared}, read {trimmed}"))


def validate_corpus(dir_path: Path, structural: bool = False) -> list[dict]:
    issues: list[dict] = []
    index_path = dir_path / "corpus-index.json"
    if not index_path.is_file():
        return [_issue("-", "index", f"missing {index_path}")]
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if index.get("kind") != "rowfolio-hostile-corpus-index":
        issues.append(_issue("-", "index", "unexpected index kind"))
    known_files = {"corpus-index.json", "README.md"}

    total = 0
    seen_artifacts: set[str] = set()
    for entry in index["cases"]:
        case_id = entry["caseId"]
        artifact_path = dir_path / entry["artifact"]
        manifest_path = dir_path / f"{case_id}.manifest.json"
        known_files.add(entry["artifact"])
        known_files.add(manifest_path.name)
        if not artifact_path.is_file():
            issues.append(_issue(case_id, "artifact", f"missing artifact {entry['artifact']}"))
            continue
        if not manifest_path.is_file():
            issues.append(_issue(case_id, "manifest", "missing case manifest"))
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for field in REQUIRED_MANIFEST_FIELDS:
            if field not in manifest:
                issues.append(_issue(case_id, "manifest", f"missing required field {field}"))
        data = artifact_path.read_bytes()
        total += len(data)
        seen_artifacts.add(entry["artifact"])
        digest = _sha256(data)
        if digest != manifest.get("sha256"):
            issues.append(
                _issue(case_id, "hash", f"artifact sha256 {digest} != manifest {manifest.get('sha256')} (changed value/row or stale hash)")
            )
        if digest != entry["sha256"]:
            issues.append(_issue(case_id, "hash", "artifact sha256 disagrees with corpus index"))
        if manifest.get("bytes") != len(data):
            issues.append(_issue(case_id, "bytes", f"manifest bytes {manifest.get('bytes')} != actual {len(data)}"))
        if manifest.get("artifact") != entry["artifact"]:
            issues.append(_issue(case_id, "manifest", "artifact filename disagreement between manifest and index"))
        for row in manifest.get("expected", {}).get("parsedRows", []):
            for value in row:
                if isinstance(value, str) and len(value) >= CELL_TEXT_MAX_CHARS:
                    issues.append(_issue(case_id, "bounds", "declared cell text exceeds guardrail"))
        if structural:
            if manifest.get("mediaType") == "text/csv":
                if len(data) == 0:
                    shape = manifest.get("expected", {}).get("tableShape", {})
                    if shape.get("records") != 0:
                        issues.append(_issue(case_id, "structural.records", "empty file must declare 0 records"))
                else:
                    _structural_csv(case_id, manifest, data, issues)
                    _exact_sums(case_id, manifest, _read_csv_rows(data), issues)
            else:
                _structural_xlsx(case_id, manifest, data, issues)

    # bounds
    if total >= TOTAL_MAX_BYTES:
        issues.append(_issue("-", "bounds", f"corpus total {total} >= 20 MB"))
    for artifact_path in sorted(dir_path.iterdir()):
        if not artifact_path.is_file() or artifact_path.name in {"corpus-index.json", "README.md"}:
            continue
        if artifact_path.suffix == ".csv":
            if artifact_path.name not in seen_artifacts:
                issues.append(_issue("-", "index", f"file not covered by index: {artifact_path.name}"))
                continue
            with artifact_path.open("rb") as fh:
                lines = sum(1 for _ in fh)
            data_rows = max(lines - 1, 0)
            if data_rows >= CSV_MAX_DATA_ROWS:
                issues.append(_issue(artifact_path.stem, "bounds", f"CSV data-row bound exceeded ({data_rows})"))
        elif artifact_path.suffix == ".xlsx":
            if artifact_path.name not in seen_artifacts:
                issues.append(_issue("-", "index", f"file not covered by index: {artifact_path.name}"))
                continue
            with zipfile.ZipFile(artifact_path) as zf:
                infos = zf.infolist()
                entries = len(infos)
                expanded = sum(i.file_size for i in infos)
            if entries >= XLSX_MAX_ENTRIES:
                issues.append(_issue(artifact_path.stem, "bounds", f"entry bound exceeded ({entries})"))
            if expanded >= XLSX_MAX_EXPANDED_BYTES:
                issues.append(_issue(artifact_path.stem, "bounds", f"expanded byte bound exceeded ({expanded})"))
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    parser.add_argument("--structural", action="store_true", help="enable light independent structural cross-checks")
    parser.add_argument("--json", action="store_true", help="emit JSON report to stdout")
    args = parser.parse_args()
    issues = validate_corpus(args.dir, structural=args.structural)
    if args.json:
        print(json.dumps({"dir": str(args.dir), "structural": args.structural, "issues": issues}, ensure_ascii=False, indent=2))
    else:
        status = "PASS" if not issues else "FAIL"
        print(f"{status}: {len(issues)} issue(s) in {args.dir} (structural={args.structural})")
        for item in issues:
            print(f"  [{item['check']}] {item['caseId']}: {item['detail']}")
    return 0 if not issues else 1


if __name__ == "__main__":
    sys.exit(main())
