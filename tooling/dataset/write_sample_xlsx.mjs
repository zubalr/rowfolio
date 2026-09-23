#!/usr/bin/env node
/** Developer fixture wrapper, not the app parser. Run: npm --prefix tooling/dataset install;
 * node tooling/dataset/write_sample_xlsx.mjs /tmp/sample_operations.xlsx
 * Does not overwrite the bound source unless explicitly given that path. */
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const output=process.argv[2];
if(!output){console.error('Provide an output path. Regeneration changes source byte identity; run bind_artifacts.py afterward.');process.exit(2);}
const {headers,rows}=JSON.parse(await fs.readFile(path.join(root,'fixtures/sample/sample_rows.json'),'utf8'));
const calendar=JSON.parse(await fs.readFile(path.join(root,'fixtures/sample/reporting_calendar.json'),'utf8'));
const wb=new ExcelJS.Workbook();wb.creator='Rowfolio';wb.created=new Date('2026-09-20T00:00:00Z');wb.modified=wb.created;
function sheet(name,heads,values){const s=wb.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});s.addRow(heads);s.addRows(values);s.autoFilter={from:{row:1,column:1},to:{row:values.length+1,column:heads.length}};s.columns.forEach(c=>c.width=20);s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF172B35'}};s.getRow(1).height=26;return s;}
const numeric=new Set(['revenue','target_revenue','order_volume','operating_cost','downtime_minutes','maintenance_cost','csat_score']);
const values=rows.map(row=>headers.map((h,i)=>{const v=Array.isArray(row)?row[i]:row[h];return v===''||v===null?null:numeric.has(h)?Number(v):String(v)}));
const ops=sheet('Operations',headers,values);for(const h of ['revenue','target_revenue','operating_cost','maintenance_cost'])ops.getColumn(headers.indexOf(h)+1).numFmt='#,##0.00';
const meaning={
  operation_id:['Identifier','Unique operation; exact raw copies are duplicate candidates'],
  date:['ISO date-only','One of the 20 declared reporting days per period'],
  region:['Category','North, South, East, West, Central, Coast'],
  site:['Identifier','Five sites per region; source grain is date + site'],
  revenue:['USD','Additive site-day revenue'],
  target_revenue:['USD','Allocated site-day target; not a repeated monthly target'],
  order_volume:['Orders','Additive whole count'],
  operating_cost:['USD','Selected operating expenses; not net-profit accounting'],
  downtime_minutes:['Minutes','Additive lost-service minutes'],
  maintenance_cost:['USD','Subset of operating_cost; do not add twice'],
  csat_score:['Score 0-100','Nullable descriptive score; never sum'],
};
sheet('Dictionary',['Field','Unit / type','Definition'],headers.map(h=>[h,...meaning[h]]));
sheet('Calendar',['date','period'],calendar.map(x=>[x.date,x.period]));
await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});await wb.xlsx.writeFile(output);console.log(`Wrote ${path.resolve(output)} (${values.length} source records). Rebind through the production pipeline before shipping.`);
