#!/usr/bin/env python3
"""Corpus verification driver.

Runs, in order:
  1. integrity/bounds + structural validation of the committed corpus
  2. double regeneration into disposable directories and byte comparison
     against each other and the committed corpus (repeatability)
  3. mutation self-tests on disposable copies:
       - one changed value must be detected (hash)
       - one deleted row must be detected (hash, and record count after
         re-hashing proves the structural check adds a second net)
       - a stale manifest hash must be detected
       - a deleted OOXML row must be detected
       - an over-bound CSV (5,001 data rows) must be rejected
  4. prints a JSON summary; writes nothing inside the repository

Internal run reports are private: pass --report PATH to also write the
summary outside Git (never commit that file).

Usage: python3 run_corpus_checks.py [--report PATH]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

TOOLING_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLING_DIR.parents[2]
COMMITTED_CORPUS = REPO_ROOT / "fixtures" / "hostile" / "generated"

sys.path.insert(0, str(TOOLING_DIR))
from generate_hostile_corpus import write_corpus  # noqa: E402
from validate_hostile_corpus import validate_corpus  # noqa: E402


def _dir_hashes(dir_path: Path) -> dict[str, str]:
    """Hash generated corpus files. README.md is excluded: it is hand-written
    documentation, not generator output."""
    out: dict[str, str] = {}
    for path in sorted(dir_path.rglob("*")):
        if path.is_file() and path.name != "README.md":
            out[str(path.relative_to(dir_path))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def _run_validator(dir_path: Path, structural: bool) -> list[dict]:
    return validate_corpus(dir_path, structural=structural)


def _check(expect_issues: bool, label: str, issues: list[dict], results: list[dict]) -> bool:
    ok = bool(issues) if expect_issues else not issues
    results.append(
        {
            "check": label,
            "expected": "detected" if expect_issues else "clean",
            "actual": "detected" if issues else "clean",
            "ok": ok,
            "issues": issues if expect_issues else issues[:5],
        }
    )
    return ok


def _mutate_csv_value(path: Path) -> None:
    data = path.read_text(encoding="utf-8")
    assert "130.00" in data, "expected sentinel value present"
    path.write_text(data.replace("130.00", "131.00", 1), encoding="utf-8")


def _drop_last_csv_row(path: Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    assert len(lines) >= 3
    path.write_text("".join(lines[:-1]), encoding="utf-8")


def _refresh_manifest_hash(corpus_dir: Path, case_id: str) -> None:
    artifact = next(p for p in corpus_dir.iterdir() if p.stem == case_id and p.suffix != ".json")
    manifest_path = corpus_dir / f"{case_id}.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    data = artifact.read_bytes()
    manifest["sha256"] = hashlib.sha256(data).hexdigest()
    manifest["bytes"] = len(data)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _mutate_xlsx_row(path: Path) -> None:
    """Delete the last data row of the single-sheet fixture by rewriting the
    worksheet part without it (simulates a lost record inside the package)."""
    import io
    import zipfile

    with zipfile.ZipFile(path) as zf:
        items = [(i, zf.read(i.filename)) for i in zf.infolist()]
    last = items[-1]
    xml = last[1].decode("utf-8")
    import re

    rows = re.findall(r"<row .*?</row>", xml)
    assert len(rows) >= 2
    xml = xml.replace(rows[-1], "")
    items[-1] = (last[0], xml.encode("utf-8"))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        for info, data in items:
            zf.writestr(info, data)
    path.write_bytes(buf.getvalue())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=None, help="private path for the JSON summary (never commit)")
    args = parser.parse_args()

    results: list[dict] = []
    all_ok = True

    # 1. committed corpus validates
    issues = _run_validator(COMMITTED_CORPUS, structural=True)
    all_ok &= _check(False, "committed-corpus-clean", issues, results)

    # 2. double regeneration into disposable directories
    with tempfile.TemporaryDirectory(prefix="rowfolio-corpus-") as tmp:
        tmp_a = Path(tmp) / "gen-a"
        tmp_b = Path(tmp) / "gen-b"
        write_corpus(tmp_a)
        write_corpus(tmp_b)
        hashes_a = _dir_hashes(tmp_a)
        hashes_b = _dir_hashes(tmp_b)
        results.append(
            {
                "check": "regeneration-repeatability",
                "expected": "identical hashes across two independent runs",
                "actual": "identical" if hashes_a == hashes_b else "diverged",
                "ok": hashes_a == hashes_b,
                "files": len(hashes_a),
            }
        )
        all_ok &= hashes_a == hashes_b
        committed = _dir_hashes(COMMITTED_CORPUS)
        results.append(
            {
                "check": "committed-matches-generator",
                "expected": "committed corpus identical to generator output",
                "actual": "identical" if committed == hashes_a else "diverged",
                "ok": committed == hashes_a,
                "files": len(committed),
            }
        )
        all_ok &= committed == hashes_a

        # 3. mutation self-tests on disposable copies
        csv_case = "csv-missing-required-measure"
        work = Path(tmp) / "mutations" / csv_case
        shutil.copytree(tmp_a / csv_case if (tmp_a / csv_case).is_dir() else tmp_a, work)
        # write_corpus output is flat; copy the flat dir per-case files instead
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True)
        for name in (f"{csv_case}.csv", f"{csv_case}.manifest.json", "corpus-index.json"):
            shutil.copy(tmp_a / name, work / name)

        # 3a. changed value detected by hash
        val = work / f"{csv_case}.csv"
        _mutate_csv_value(val)
        issues = _run_validator(work, structural=False)
        all_ok &= _check(True, "mutation-changed-value-detected", issues, results)

        # 3b. missing row detected by hash; structural count after re-hash
        _drop_last_csv_row(val)
        issues = _run_validator(work, structural=True)
        all_ok &= _check(True, "mutation-missing-row-detected-hash", issues, results)
        _refresh_manifest_hash(work, csv_case)
        issues = _run_validator(work, structural=True)
        all_ok &= _check(
            True,
            "mutation-missing-row-detected-structural",
            [i for i in issues if i["check"].startswith("structural.")],
            results,
        )

        # 3c. stale hash detected
        shutil.copy(tmp_a / f"{csv_case}.csv", work / f"{csv_case}.csv")  # restore artifact
        manifest_path = work / f"{csv_case}.manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["sha256"] = "0" * 64
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        issues = _run_validator(work, structural=False)
        all_ok &= _check(True, "mutation-stale-hash-detected", issues, results)

        # 3d. deleted OOXML row detected by hash
        xlsx_work = Path(tmp) / "mutations-xlsx"
        xlsx_work.mkdir()
        xlsx_case = "xlsx-minimal-valid"
        shutil.copy(tmp_a / f"{xlsx_case}.xlsx", xlsx_work / f"{xlsx_case}.xlsx")
        shutil.copy(tmp_a / f"{xlsx_case}.manifest.json", xlsx_work / f"{xlsx_case}.manifest.json")
        shutil.copy(tmp_a / "corpus-index.json", xlsx_work / "corpus-index.json")
        _mutate_xlsx_row(xlsx_work / f"{xlsx_case}.xlsx")
        issues = _run_validator(xlsx_work, structural=False)
        all_ok &= _check(True, "mutation-xlsx-row-detected", issues, results)

        # 3e. over-bound CSV rejected
        over = Path(tmp) / "mutations-bounds"
        over.mkdir()
        big = over / "oversize.csv"
        with big.open("w", encoding="utf-8", newline="") as fh:
            fh.write("id,value\n")
            for i in range(5001):
                fh.write(f"{i},{i}\n")
        (over / "oversize.manifest.json").write_text(
            json.dumps(
                {
                    "caseId": "oversize",
                    "category": "bounds_probe",
                    "description": "over-bound probe, not part of the corpus",
                    "artifact": "oversize.csv",
                    "mediaType": "text/csv",
                    "sha256": hashlib.sha256(big.read_bytes()).hexdigest(),
                    "bytes": big.stat().st_size,
                    "expected": {"tableShape": {"records": 5001, "headerColumns": 2, "perRecordFieldCounts": []}},
                    "generator": "run_corpus_checks.py",
                    "corpusVersion": "probe",
                }
            )
            + "\n",
            encoding="utf-8",
        )
        (over / "corpus-index.json").write_text(
            json.dumps(
                {
                    "schemaVersion": "probe",
                    "kind": "rowfolio-hostile-corpus-index",
                    "generator": "run_corpus_checks.py",
                    "bounds": {},
                    "totals": {"cases": 1, "bytes": big.stat().st_size},
                    "cases": [{"caseId": "oversize", "artifact": "oversize.csv", "sha256": "", "bytes": 0}],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        issues = _run_validator(over, structural=False)
        all_ok &= _check(
            True,
            "bounds-csv-5001-rows-rejected",
            [i for i in issues if i["check"] == "bounds"],
            results,
        )

    # 4. summary
    passed = sum(1 for r in results if r["ok"])
    summary = {
        "suite": "rowfolio hostile corpus checks",
        "ok": all_ok,
        "checksPassed": passed,
        "checksTotal": len(results),
        "results": results,
    }
    text = json.dumps(summary, ensure_ascii=False, indent=2)
    print(text)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text + "\n", encoding="utf-8")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
