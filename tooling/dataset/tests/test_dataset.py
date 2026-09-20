#!/usr/bin/env python3
"""Dataset fixture tests. Python 3.11+, standard library only.

Run from repo root:
    python -m unittest discover -s tooling/dataset/tests -v
"""
from __future__ import annotations
import csv, hashlib, importlib.util, json, subprocess, sys, tempfile, unittest, zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TOOLING = ROOT / 'tooling' / 'dataset'
SAMPLE = ROOT / 'fixtures' / 'sample'
GOLDEN = ROOT / 'fixtures' / 'golden'

def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

verify_sample = _load('verify_sample', TOOLING / 'verify_sample.py')
generate_sample = _load('generate_sample', TOOLING / 'generate_sample.py')

GENERATED = [
    'sample_operations.csv', 'expected_clean.csv', 'sample_rows.json',
    'expected_monthly.json', 'expected_quality.json', 'reporting_calendar.json',
    'sample_manifest.json',
]

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

class TestDeterminism(unittest.TestCase):
    def test_regenerate_twice_byte_identical(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            generate_sample.main(Path(a)); generate_sample.main(Path(b))
            for name in GENERATED:
                self.assertEqual((Path(a)/name).read_bytes(), (Path(b)/name).read_bytes(), name)

    def test_committed_fixtures_match_regeneration(self):
        with tempfile.TemporaryDirectory() as d:
            generate_sample.main(Path(d))
            for name in GENERATED:
                self.assertEqual((Path(d)/name).read_bytes(), (SAMPLE/name).read_bytes(), name)

class TestOracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = verify_sample.verify(SAMPLE)
        (GOLDEN/'oracle_report.json').write_text(
            json.dumps(cls.report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

    def test_counts(self):
        r = self.report
        self.assertEqual((r['rawRecords'], r['cleanRecords'], r['qualityIssues']), (2417, 2400, 29))

    def test_headline_truth(self):
        r = self.report
        self.assertEqual(r['northJuneRevenue'], '881000')
        self.assertEqual(r['northJuneTarget'], '1000000')
        self.assertEqual(r['northGapRatio'], '-0.119')
        self.assertEqual((r['northMayDowntime'], r['northJuneDowntime']), ('1194', '1565'))
        self.assertEqual(r['northOrderChangeRatio'], '0.08')
        self.assertEqual((r['juneRevenue'], r['juneCost']), ('6000000.00', '4500000.00'))
        self.assertEqual((r['baseMargin'], r['scenarioMargin']), ('0.25', '0.19'))

    def test_exact_north_source_spans(self):
        """Provenance contract: North May = Operations rows 1202–1301,
        North June = rows 1802–1901 (one-based physical source rows)."""
        self.assertEqual(self.report['northMaySourceRows'], list(range(1202, 1302)))
        self.assertEqual(self.report['northJuneSourceRows'], list(range(1802, 1902)))

    def test_anomaly_and_missingness_preserved(self):
        self.assertEqual(self.report['eastAnomaly'],
                         {'sourceRow': 2044, 'date': '2026-06-11', 'site': 'EA-03', 'minutes': 210})
        quality = json.loads((SAMPLE/'expected_quality.json').read_text())
        missing = sorted(q['sourceRow'] for q in quality if q['kind'] == 'missing_optional')
        self.assertEqual(missing, [40, 447, 999, 1645, 2257])
        for q in quality:
            if q['kind'] == 'missing_optional':
                self.assertEqual(q['action'], 'retain_missing')
        missing_rows = {r['_sourceRow'] for r in self._clean_with_rows() if r['csat_score'] == ''}
        self.assertEqual(missing_rows, {40, 447, 999, 1645, 2257})

    def _clean_with_rows(self):
        seen = set(); out = []
        with (SAMPLE/'sample_operations.csv').open(encoding='utf-8', newline='') as fh:
            for i, row in enumerate(csv.DictReader(fh), 2):
                key = tuple(row[k] for k in row)
                if key in seen: continue
                seen.add(key); row['_sourceRow'] = i; out.append(row)
        return out

    def test_oracle_report_committed_is_current(self):
        committed = json.loads((GOLDEN/'oracle_report.json').read_text())
        self.assertEqual(committed, self.report)

class TestBindingAndManifest(unittest.TestCase):
    def test_byte_hash_binding(self):
        binding = json.loads((SAMPLE/'artifact_binding.json').read_text())
        self.assertEqual(binding['sourceHash'], sha(SAMPLE/'sample_operations.xlsx'))
        self.assertEqual(binding['sourceCsvHash'], sha(SAMPLE/'sample_operations.csv'))

    def test_semantic_hash_is_separate(self):
        """normalizationRevision is a semantic hash of canonical payload — distinct
        from and independent of the byte hashes."""
        binding = json.loads((SAMPLE/'artifact_binding.json').read_text())
        with (SAMPLE/'expected_clean.csv').open(encoding='utf-8', newline='') as fh:
            clean = list(csv.DictReader(fh))
        ledger = json.loads((SAMPLE/'expected_quality.json').read_text())
        payload = {'policy': '1.0.0', 'columns': list(clean[0]), 'rows': clean,
                   'approvedIssues': [q['id'] for q in ledger if q['action'] != 'retain_missing']}
        revision = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':'),
                                             ensure_ascii=False).encode()).hexdigest()
        self.assertEqual(binding['normalizationRevision'], revision)
        self.assertNotEqual(binding['normalizationRevision'], binding['sourceHash'])
        self.assertNotEqual(binding['normalizationRevision'], binding['sourceCsvHash'])

    def test_manifest_self_consistent(self):
        m = json.loads((SAMPLE/'sample_manifest.json').read_text())
        self.assertEqual(m['seed'], 260920)
        self.assertEqual(m['sourceCsvSha256'], sha(SAMPLE/'sample_operations.csv'))
        self.assertEqual(m['cleanCsvSha256'], sha(SAMPLE/'expected_clean.csv'))
        self.assertEqual((m['rawRecords'], m['cleanRecords']), (2417, 2400))
        self.assertEqual(m['quality'], {'duplicateRows': 17, 'categoryCells': 7,
                                        'missingOptionalCells': 5, 'issueCount': 29,
                                        'resolved': 24, 'unresolved': 5})
        ledger = json.loads((SAMPLE/'expected_quality.json').read_text())
        self.assertEqual(len(ledger), 29)

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def _xlsx_shared_strings(z):
    try:
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
    except KeyError:
        return []
    return [''.join(t.text or '' for t in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')) for si in root]

def _xlsx_sheet_cells(z, sheet_path, shared):
    root = ET.fromstring(z.read(sheet_path))
    cells = {}
    for c in root.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
        ref = c.attrib['r']; t = c.attrib.get('t')
        v = c.find('m:v', NS)
        if t == 's':
            cells[ref] = shared[int(v.text)]
        elif t == 'inlineStr':
            is_el = c.find('m:is', NS)
            cells[ref] = ''.join(e.text or '' for e in is_el.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t'))
        elif v is not None:
            cells[ref] = v.text
        else:
            cells[ref] = None
    return cells

class TestXlsxSourceCells(unittest.TestCase):
    """XML source-cell comparison: every Operations cell in the bound workbook
    equals the canonical CSV cell; metadata sheets exist with expected headers."""

    @classmethod
    def setUpClass(cls):
        cls.z = zipfile.ZipFile(SAMPLE/'sample_operations.xlsx')
        cls.shared = _xlsx_shared_strings(cls.z)
        wb = ET.fromstring(cls.z.read('xl/workbook.xml'))
        rels = ET.fromstring(cls.z.read('xl/_rels/workbook.xml.rels'))
        rel_map = {r.attrib['Id']: r.attrib['Target'] for r in rels}
        cls.sheets = {}
        for s in wb.find('m:sheets', NS):
            rid = s.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
            target = rel_map[rid].lstrip('/')
            cls.sheets[s.attrib['name']] = target if target.startswith('xl/') else 'xl/'+target

    def test_sheet_inventory(self):
        self.assertEqual(set(self.sheets), {'Operations', 'Dictionary', 'Calendar'})

    def test_operations_cells_match_csv(self):
        cells = _xlsx_sheet_cells(self.z, self.sheets['Operations'], self.shared)
        headers = generate_sample.HEADERS
        with (SAMPLE/'sample_operations.csv').open(encoding='utf-8', newline='') as fh:
            rows = list(csv.DictReader(fh))
        for j, h in enumerate(headers):
            self.assertEqual(cells[f'{chr(65+j)}1'], h)
        def col_letters(n):
            letters = ''
            while n: n, rem = divmod(n-1, 26); letters = chr(65+rem)+letters
            return letters
        for i, row in enumerate(rows, start=2):
            for j, h in enumerate(headers):
                ref = f'{col_letters(j+1)}{i}'
                got = cells.get(ref)
                want = row[h]
                if want == '':
                    self.assertIn(got, (None, ''), ref)
                elif h in generate_sample.MONEY or h in ('order_volume', 'downtime_minutes', 'csat_score'):
                    self.assertEqual(Decimal(got), Decimal(want), ref)
                else:
                    self.assertEqual(got, want, ref)

    def test_metadata_sheets_not_counted(self):
        ops = _xlsx_sheet_cells(self.z, self.sheets['Operations'], self.shared)
        max_row = max(int(''.join(ch for ch in ref if ch.isdigit())) for ref in ops)
        self.assertEqual(max_row, 2418)  # header + 2417 raw records

    def test_metadata_sheet_headers(self):
        dictionary = _xlsx_sheet_cells(self.z, self.sheets['Dictionary'], self.shared)
        self.assertEqual((dictionary['A1'], dictionary['B1'], dictionary['C1']),
                         ('Field', 'Unit / type', 'Definition'))
        self.assertEqual(dictionary['A2'], 'operation_id')
        calendar = _xlsx_sheet_cells(self.z, self.sheets['Calendar'], self.shared)
        self.assertEqual((calendar['A1'], calendar['B1']), ('date', 'period'))
        self.assertEqual(len(calendar), 162)  # header + 80 scheduled days

    @classmethod
    def tearDownClass(cls):
        cls.z.close()

class TestGoldenFixtureHashes(unittest.TestCase):
    def test_manifest_hashes_file_current(self):
        hashes = json.loads((GOLDEN/'fixture_hashes.json').read_text())
        for name, digest in hashes['files'].items():
            self.assertEqual(digest, sha(SAMPLE/name), name)
        self.assertEqual(hashes['files']['sample_operations.xlsx'], sha(SAMPLE/'sample_operations.xlsx'))

if __name__ == '__main__':
    unittest.main()
