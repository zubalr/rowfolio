#!/usr/bin/env python3
"""Write fixtures/golden truth files derived ONLY from oracle output and
committed sample fixtures. Never hand-author analytical values here.

Run: python tooling/dataset/export_golden.py
"""
from __future__ import annotations
import hashlib, importlib.util, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLING = ROOT / 'tooling' / 'dataset'
SAMPLE = ROOT / 'fixtures' / 'sample'
GOLDEN = ROOT / 'fixtures' / 'golden'

spec = importlib.util.spec_from_file_location('verify_sample', TOOLING / 'verify_sample.py')
verify_sample = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_sample)

def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) + '\n'

def spans(rows):
    """Sorted contiguous source rows -> canonical inclusive spans."""
    out = []
    for r in sorted(rows):
        if out and r == out[-1]['end'] + 1:
            out[-1]['end'] = r
        else:
            out.append({'start': r, 'end': r})
    return out

def main():
    GOLDEN.mkdir(parents=True, exist_ok=True)
    report = verify_sample.verify(SAMPLE)
    (GOLDEN / 'oracle_report.json').write_text(dumps(report), encoding='utf-8')
    golden_spans = {
        'schemaVersion': '1.0.0',
        'sourceRefId': 'source-operations',
        'coordinateSystem': 'one-based physical worksheet rows, sheet S0 (Operations)',
        'northMayOrders': {'period': '2026-05', 'region': 'North',
                           'metric': 'order_volume', 'expected': '10000',
                           'spans': spans(report['northMaySourceRows'])},
        'northMayDowntime': {'period': '2026-05', 'region': 'North',
                             'metric': 'downtime_minutes', 'expected': '1194',
                             'spans': spans(report['northMaySourceRows'])},
        'northJuneRevenue': {'period': '2026-06', 'region': 'North',
                             'metric': 'revenue', 'expected': '881000',
                             'spans': spans(report['northJuneSourceRows'])},
        'northJuneTarget': {'period': '2026-06', 'region': 'North',
                            'metric': 'target_revenue', 'expected': '1000000',
                            'spans': spans(report['northJuneSourceRows'])},
        'eastAnomaly': {'sheet': 'Operations', **report['eastAnomaly']},
    }
    (GOLDEN / 'expected_source_spans.json').write_text(dumps(golden_spans), encoding='utf-8')
    files = {}
    for p in sorted(SAMPLE.iterdir()):
        if p.is_file() and p.name != 'candidate_binding.json':
            files[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
    (GOLDEN / 'fixture_hashes.json').write_text(
        dumps({'schemaVersion': '1.0.0', 'algorithm': 'sha256', 'files': files}), encoding='utf-8')
    print(f'Wrote golden fixtures to {GOLDEN}')

if __name__ == '__main__':
    main()
