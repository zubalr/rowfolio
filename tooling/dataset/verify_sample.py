#!/usr/bin/env python3
"""Independent CSV/Decimal oracle: does NOT import generator or trust expected totals."""
from __future__ import annotations
import csv, json, hashlib, argparse
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP, getcontext
getcontext().prec=40
getcontext().rounding=ROUND_HALF_UP
D=Decimal

def verify(root:Path):
    rows=list(csv.DictReader((root/'sample_operations.csv').open(encoding='utf-8',newline='')))
    manifest=json.loads((root/'sample_manifest.json').read_text())
    seen={};clean=[];duplicate=[];category=[];missing=[]
    known={x.casefold():x for x in manifest['regions']}
    for rownum,row in enumerate(rows,2):
        key=tuple(row[k] for k in row)
        if key in seen: duplicate.append((rownum,seen[key]));continue
        seen[key]=rownum
        canon=known[row['region'].strip().casefold()]
        if canon!=row['region']:category.append(rownum)
        row['region']=canon
        if row['csat_score']=='':missing.append(rownum)
        row['_sourceRow']=rownum;clean.append(row)
    assert (len(rows),len(clean),len(duplicate),len(category),len(missing))==(2417,2400,17,7,5)
    expected=list(csv.DictReader((root/'expected_clean.csv').open(encoding='utf-8',newline='')))
    assert [{k:v for k,v in r.items() if not k.startswith('_')} for r in clean]==expected
    def select(period,region=None):return [r for r in clean if r['date'].startswith(period) and (region is None or r['region']==region)]
    def total(rs,key):return sum((D(r[key]) for r in rs),D(0))
    may=select('2026-05','North'); june=select('2026-06','North'); whole=select('2026-06')
    revenue=total(june,'revenue');target=total(june,'target_revenue')
    assert revenue==881000 and target==1000000
    gap=(revenue-target)/target; assert gap==D('-.119')
    prev=total(may,'downtime_minutes');curr=total(june,'downtime_minutes');assert(prev,curr)==(1194,1565)
    change=(curr-prev)/prev
    assert change.quantize(D('.0001'),rounding=ROUND_HALF_UP)==D('.3107')
    order_delta=(total(june,'order_volume')-total(may,'order_volume'))/total(may,'order_volume');assert order_delta==D('.08')
    R=total(whole,'revenue');C=total(whole,'operating_cost');assert(R,C)==(6000000,4500000)
    stressed=C*D('1.08');base_margin=(R-C)/R;scenario_margin=(R-stressed)/R
    assert (base_margin,scenario_margin)==(D('.25'),D('.19'))
    outlier=[r for r in select('2026-06','East') if D(r['downtime_minutes'])==210];assert len(outlier)==1
    for record in json.loads((root/'expected_monthly.json').read_text()):
        rs=select(record['period'],record['region'])
        for key in ['revenue','target_revenue','operating_cost','order_volume','downtime_minutes']:assert total(rs,key)==D(record[key])
    cal=json.loads((root/'reporting_calendar.json').read_text())
    for period in manifest['periods']:
        assert len(select(period))==600
        assert sorted({r['date'] for r in select(period)})==[x['date'] for x in cal if x['period']==period]
    assert manifest['sourceCsvSha256']==hashlib.sha256((root/'sample_operations.csv').read_bytes()).hexdigest()
    assert len({r['operation_id'] for r in clean})==2400
    for r in clean:assert D(r['maintenance_cost'])<=D(r['operating_cost'])
    return {
      'passed':True,'oracle':'independent CSV + Python Decimal','assertions':'counts, normalization, duplicates, all 24 region-period aggregates, coverage, source hash, target gap, downtime, orders, scenario, subset and anomaly',
      'rawRecords':2417,'cleanRecords':2400,'qualityIssues':29,
      'northJuneRevenue':'881000','northJuneTarget':'1000000','northGapRatio':str(gap),
      'northMayDowntime':'1194','northJuneDowntime':'1565','downtimeChangeRatio':str(change),
      'northOrderChangeRatio':str(order_delta),'juneRevenue':str(R),'juneCost':str(C),
      'baseContribution':str(R-C),'scenarioContribution':str(R-stressed),'baseMargin':str(base_margin),'scenarioMargin':str(scenario_margin),
      'northMaySourceRows':[r['_sourceRow'] for r in may],'northJuneSourceRows':[r['_sourceRow'] for r in june],
      'eastAnomaly':{'sourceRow':outlier[0]['_sourceRow'],'date':outlier[0]['date'],'site':outlier[0]['site'],'minutes':210},
    }

if __name__=='__main__':
    default_fixtures=Path(__file__).resolve().parents[2]/'fixtures'/'sample'
    p=argparse.ArgumentParser();p.add_argument('--fixtures',type=Path,default=default_fixtures);p.add_argument('--report',type=Path);a=p.parse_args();result=verify(a.fixtures)
    text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if a.report:a.report.write_text(text,encoding='utf-8')
    print(text)
