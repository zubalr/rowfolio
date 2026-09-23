#!/usr/bin/env python3
"""Bind source bytes to semantic truth. Fail closed on source identity drift.

Byte identity (``sourceHash`` = SHA-256 of the original XLSX) is checked
separately from semantic identity (``normalizationRevision`` = SHA-256 of the
canonical payload: policy version + column order + clean rows + approved issue
IDs). Never certify the unimplemented browser parser.

Default checks the committed reference binding in ``fixtures/sample/``.
``--candidate PATH`` writes a pending binding for a regenerated workbook; it
does not silently rewrite proof fixtures.
"""
import argparse,csv,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SAMPLE=ROOT/'fixtures'/'sample'
GOLDEN=ROOT/'fixtures'/'golden'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path);a=p.parse_args()
 binding=json.loads((SAMPLE/'artifact_binding.json').read_text())
 clean=list(csv.DictReader((SAMPLE/'expected_clean.csv').open(encoding='utf-8',newline='')))
 ledger=json.loads((SAMPLE/'expected_quality.json').read_text())
 payload={'policy':'1.0.0','columns':list(clean[0]),'rows':clean,'approvedIssues':[q['id'] for q in ledger if q['action']!='retain_missing']}
 revision=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
 source=a.candidate or SAMPLE/'sample_operations.xlsx'
 actual={'sourceHash':sha(source),'sourceCsvHash':sha(SAMPLE/'sample_operations.csv'),'normalizationRevision':revision}
 if a.candidate:
  result={**binding,**actual,'sourceFile':source.name,'status':'pending-production-rebuild','productionParserVerified':False,'note':'Candidate bytes only. Bounded XLSX ingestion, normalization and analysis must run through the production engine; compare independent oracle; rebuild all proofs, snapshots, exports and IDs together.'}
  target=GOLDEN/'candidate_binding.json';target.write_text(json.dumps(result,indent=2)+'\n');print(f'Candidate recorded in {target}; NOT approved for release.');return
 for k,v in actual.items():
  if binding[k]!=v:raise SystemExit(f'{k} mismatch. Do not edit only this hash. Rebuild fixtures through production pipeline and regenerate all artifacts.')
 assert binding['productionParserVerified'] is False
 print('Reference binding matches source bytes and documented canonical payload. Production-parser verification remains pending.')
if __name__=='__main__':main()
