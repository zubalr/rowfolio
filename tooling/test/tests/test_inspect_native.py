#!/usr/bin/env python3
"""Native-inspector corpus tests — Python stdlib only.

The JS inspector (tooling/test/inspect.ts) is checked by the vitest suite;
this module re-verifies the same hostile corpus with an independent
implementation so no verdict relies on a single parser.

Run from repo root:
    python3 -m unittest discover -s tooling/test/tests -v
"""
from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HOSTILE = ROOT / 'fixtures' / 'hostile'
MANIFEST = json.loads((HOSTILE / 'manifest.json').read_text())


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


inspect_native = _load('inspect_native', ROOT / 'tooling' / 'test' / 'inspect_native.py')


def _native_entries():
    return [e for e in MANIFEST['fixtures'] if e['inspector'] == 'native']


class HostileCorpus(unittest.TestCase):
    def test_every_native_entry_produces_expected_findings(self):
        for entry in _native_entries():
            path = HOSTILE / entry['path']
            with self.subTest(fixture=entry['path']):
                self.assertTrue(path.is_file(), 'missing fixture %s' % entry['path'])
                report = inspect_native.inspect_file(path)
                codes = {f['code'] for f in report['findings']}
                for expected in entry['expect']:
                    self.assertIn(expected, codes,
                                  '%s should detect %s (got %s)' % (entry['path'], expected, sorted(codes)))
                if not entry['expect']:
                    errors = [f['code'] for f in report['findings'] if f['severity'] == 'error']
                    self.assertEqual(errors, [], 'control fixture %s produced errors %s' % (entry['path'], errors))

    def test_fixture_sizes_within_envelope(self):
        env = MANIFEST['envelope']
        for entry in MANIFEST['fixtures']:
            path = HOSTILE / entry['path']
            if not path.is_file():
                continue
            with self.subTest(fixture=entry['path']):
                self.assertLessEqual(path.stat().st_size, env['maxFileBytes'],
                                     '%s exceeds %d-byte envelope' % (entry['path'], env['maxFileBytes']))


if __name__ == '__main__':
    unittest.main()
