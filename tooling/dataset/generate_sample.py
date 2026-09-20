#!/usr/bin/env python3
"""Reproducible synthetic data. Python 3.11+, standard library only.

Use --out DIR. Cells/CSV/JSON are canonical; XLSX ZIP timestamps are not identity.
Default output is the committed fixture directory ``fixtures/sample/``.
"""
from __future__ import annotations
import argparse, calendar, csv, hashlib, io, json, random
from copy import deepcopy
from datetime import date
from decimal import Decimal
from pathlib import Path

SEED = 260920
REGIONS = ['North', 'South', 'East', 'West', 'Central', 'Coast']
HEADERS = ['operation_id','date','region','site','revenue','target_revenue','order_volume','operating_cost','downtime_minutes','maintenance_cost','csat_score']
MONEY = {'revenue','target_revenue','operating_cost','maintenance_cost'}

def dumps(obj):
    return json.dumps(obj,ensure_ascii=False,sort_keys=True,indent=2)+'\n'

def spread(total:int,n:int,rng:random.Random)->list[int]:
    """Positive integer weights; largest remainder, stable index tie-break."""
    weights=[rng.randint(75,125) for _ in range(n)]; den=sum(weights)
    base=[total*w//den for w in weights]
    for i in sorted(range(n),key=lambda i:(-(total*weights[i]%den),i))[:total-sum(base)]: base[i]+=1
    assert sum(base)==total
    return base

def reporting_days(month:int)->list[str]:
    days=[date(2026,month,d) for d in range(1,calendar.monthrange(2026,month)[1]+1) if date(2026,month,d).weekday()<5]
    return [d.isoformat() for d in days[:20]]

def build():
    rng=random.Random(SEED); rows=[]; monthly=[]
    june_revenue=[881000,1060000,1020000,1040000,1049000,950000]
    june_cost=[740000,765000,750000,760000,745000,740000]
    for month in range(3,7):
        for ri,region in enumerate(REGIONS):
            if month==6:
                revenue=june_revenue[ri]; cost=june_cost[ri]
            elif ri==0:
                revenue={3:980000,4:970000,5:950000}[month]
                cost={3:627200,4:659600,5:693500}[month]
            else:
                revenue=880000+ri*23000+(month-3)*27000
                cost=revenue*(68+ri)//100
            target=1000000 if ri==0 else (1020000+ri*10000)
            orders=(10800 if month==6 else 10000 if month==5 else 9200+(month-3)*300) if ri==0 else 9200+ri*250+(month-3)*200
            downtime=({3:970,4:1080,5:1194,6:1565}[month] if ri==0 else 850+ri*70+(month-3)*20)
            if month==6 and region=='East': downtime=1320
            fields={
                'revenue':spread(revenue*100,100,rng),
                'target_revenue':spread(target*100,100,rng),
                'operating_cost':spread(cost*100,100,rng),
                'order_volume':spread(orders,100,rng),
                'downtime_minutes':spread(downtime,100,rng),
            }
            if month==6 and region=='East':
                anomaly_index=42
                rest=spread(downtime-210,99,rng)
                fields['downtime_minutes']=rest[:anomaly_index]+[210]+rest[anomaly_index:]
            monthly.append({'period':f'2026-{month:02}', 'region':region,'revenue':str(revenue),'target_revenue':str(target),'operating_cost':str(cost),'order_volume':orders,'downtime_minutes':downtime})
            for i in range(100):
                row={'operation_id':f'OP-{len(rows)+1:05}', 'date':reporting_days(month)[i//5],'region':region,'site':f'{region[:2].upper()}-{i%5+1:02}'}
                for field,values in fields.items(): row[field]=f'{Decimal(values[i])/100:.2f}' if field in MONEY else values[i]
                row['maintenance_cost']=f'{Decimal(fields["operating_cost"][i]*rng.randint(5,12)//100)/100:.2f}'
                row['csat_score']=rng.randint(76,96)
                rows.append(row)
    raw=deepcopy(rows); issues=[]
    aliases=[17,89,260,588,823,1118,1534]
    for j,i in enumerate(aliases):
        old=raw[i]['region']; raw[i]['region']=f' {old.lower()} ' if j%2 else old.upper()
        issues.append({'id':f'quality-category-{i+2}','kind':'category_variant','sourceRow':i+2,'column':'region','rawValue':raw[i]['region'],'cleanValue':old,'action':'normalize','policy':'sample-manifest-v1'})
    for i in [38,445,997,1643,2255]:
        raw[i]['csat_score']=None; rows[i]['csat_score']=None
        issues.append({'id':f'quality-missing-{i+2}','kind':'missing_optional','sourceRow':i+2,'column':'csat_score','rawValue':None,'cleanValue':None,'action':'retain_missing','policy':'never-impute-v1'})
    for i in [7+137*j for j in range(17)]:
        raw.append(deepcopy(raw[i]))
        issues.append({'id':f'quality-duplicate-{len(raw)+1}','kind':'duplicate','sourceRow':len(raw)+1,'keptSourceRow':i+2,'column':None,'rawValue':raw[i]['operation_id'],'cleanValue':None,'action':'exclude','policy':'sample-operation-id-and-all-cells-v1'})
    return raw,rows,issues,monthly

def csv_text(rows):
    s=io.StringIO(newline=''); w=csv.DictWriter(s,fieldnames=HEADERS,lineterminator='\n');w.writeheader();w.writerows(rows);return s.getvalue()

def main(out:Path):
    out.mkdir(parents=True,exist_ok=True);raw,clean,issues,monthly=build()
    for name,rows in [('sample_operations',raw),('expected_clean',clean)]:
        (out/f'{name}.csv').write_text(csv_text(rows),encoding='utf-8',newline='')
    (out/'sample_rows.json').write_text(dumps({'headers':HEADERS,'rows':raw}),encoding='utf-8')
    (out/'expected_quality.json').write_text(dumps(issues),encoding='utf-8')
    (out/'expected_monthly.json').write_text(dumps(monthly),encoding='utf-8')
    calendar_rows=[{'date':d,'period':f'2026-{m:02}'} for m in range(3,7) for d in reporting_days(m)]
    (out/'reporting_calendar.json').write_text(dumps(calendar_rows),encoding='utf-8')
    manifest={
        'schemaVersion':'1.0.0','datasetId':'regional-services-v1','seed':SEED,
        'fictional':True,'currency':'USD','sourceSheet':'Operations','sourceSheetId':'S0','headerRow':1,
        'rawRecords':len(raw),'cleanRecords':len(clean),'regions':REGIONS,'sitesPerRegion':5,
        'periods':['2026-03','2026-04','2026-05','2026-06'],
        'grain':['date','site'],'primaryKey':['operation_id'],
        'periodCoverage':'20 scheduled reporting days per period; reporting_calendar.json is authoritative',
        'missingPolicy':'No imputation; optional CSAT remains missing',
        'categoryPolicy':'Only manifest-approved case/outer-space variants; never fuzzy merge',
        'moneyScale':2,'maintenanceIsSubsetOfOperatingCost':True,
        'sourceCsvSha256':hashlib.sha256(csv_text(raw).encode()).hexdigest(),
        'cleanCsvSha256':hashlib.sha256(csv_text(clean).encode()).hexdigest(),
        'quality':{'duplicateRows':17,'categoryCells':7,'missingOptionalCells':5,'issueCount':29,'resolved':24,'unresolved':5},
        'notes':['All values synthetic. No company represented.','Target is allocated per site-day, additive once at this grain.','Operations rows 2–2401 retained; duplicate rows 2402–2418 excluded.','Compare May with June over their complete scheduled reporting periods, not a prediction.']}
    (out/'sample_manifest.json').write_text(dumps(manifest),encoding='utf-8')
    print(f'Generated {len(raw)} raw / {len(clean)} clean records at {out}')

if __name__=='__main__':
    default_out=Path(__file__).resolve().parents[2]/'fixtures'/'sample'
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,default=default_out);a=p.parse_args();main(a.out)
