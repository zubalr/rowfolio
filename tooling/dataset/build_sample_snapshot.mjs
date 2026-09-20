#!/usr/bin/env node
/**
 * Build the prepared production sample snapshot through the real engine.
 *
 * This script NEVER fabricates analytical output. It requires the merged
 * production adapters and fails closed when they are unavailable:
 *
 *   node tooling/dataset/build_sample_snapshot.mjs \
 *     --ingest <module> --normalize <module> --analysis <module> \
 *     [--source fixtures/sample/sample_operations.xlsx] \
 *     [--out apps/web/public/sample/prepared.snapshot.json]
 *
 * Each module specifier must resolve under normal Node resolution (workspace
 * package name like @rowfolio/ingest, or an explicit file path) and export the
 * contract signatures from contracts/INTERFACES.md:
 *   ingest:    parseSource(bytes, sourceName, options, progress) -> Promise<RawTable>
 *   normalize: profileTable(raw) -> {proposedColumns, issues}
 *              normalizeTable(raw, approvals) -> NormalizedTable
 *   analysis:  analyze(table, {version:'1.0.0', confirmedScope, samplePolicyId})
 *              -> AnalysisSnapshot
 *
 * The snapshot written is exactly what the adapters return, wrapped in a
 * manifest that records byte hash (SHA-256 of source bytes), semantic hashes,
 * and the generator seed — byte identity and semantic identity stay separate.
 */
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const args=Object.fromEntries(process.argv.slice(2).reduce((acc,cur,i,arr)=>{
  if(cur.startsWith('--'))acc.push([cur.slice(2),arr[i+1]]);return acc;
},[]));

const sourcePath=path.resolve(root,args.source??'fixtures/sample/sample_operations.xlsx');
const outPath=path.resolve(root,args.out??'apps/web/public/sample/prepared.snapshot.json');

function fail(msg){console.error(`build_sample_snapshot: ${msg}`);process.exit(2);}

async function loadAdapter(spec,name,fns){
  if(!spec)fail(`--${name} module specifier is required; refusing to fabricate a snapshot without the production adapter.`);
  let mod;
  try{
    const resolved=spec.startsWith('.')||spec.startsWith('/')?pathToFileURL(path.resolve(root,spec)).href:spec;
    mod=await import(resolved);
  }catch(e){fail(`cannot import ${name} adapter '${spec}': ${e.message}`);}
  for(const fn of fns)if(typeof mod[fn]!=='function')fail(`adapter '${spec}' does not export required function ${fn}()`);
  return mod;
}

const manifest=JSON.parse(await readFile(path.join(root,'fixtures/sample/sample_manifest.json'),'utf8'));
JSON.parse(await readFile(path.join(root,'fixtures/sample/reporting_calendar.json'),'utf8'));
const binding=JSON.parse(await readFile(path.join(root,'fixtures/sample/artifact_binding.json'),'utf8'));

const bytes=await readFile(sourcePath);
const sourceHash=createHash('sha256').update(bytes).digest('hex');
if(sourceHash!==binding.sourceHash)
  fail(`source bytes sha256 ${sourceHash} != bound sourceHash ${binding.sourceHash}. Rebind via bind_artifacts.py after an intentional source change; never patch this check.`);

const ingest=await loadAdapter(args.ingest,'ingest',['parseSource']);
const normalize=await loadAdapter(args.normalize,'normalize',['profileTable','normalizeTable']);
const analysis=await loadAdapter(args.analysis,'analysis',['analyze']);

const progress=(stage,fraction)=>console.error(`[${stage}] ${fraction===null?'…':(fraction*100).toFixed(1)+'%'}`);

const raw=await ingest.parseSource(
  bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
  manifest.sourceFile??'sample_operations.xlsx',
  {selectedSheetId:manifest.sourceSheetId,headerRow:manifest.headerRow,allowHiddenSheet:false},
  progress);

const {proposedColumns,issues}=await normalize.profileTable(raw);
const approvedIds=new Set(JSON.parse(await readFile(path.join(root,'fixtures/sample/expected_quality.json'),'utf8'))
  .filter(q=>q.action!=='retain_missing').map(q=>q.id));
const plan={
  issueIds:(issues??[]).filter(i=>approvedIds.has(i.id)).map(i=>i.id),
  columns:proposedColumns,
  useUnverifiedFormulaCaches:[],
};
const table=await normalize.normalizeTable(raw,plan);
if(table.normalizationRevision!==binding.normalizationRevision)
  fail(`normalizationRevision ${table.normalizationRevision} != bound ${binding.normalizationRevision}. Semantic payload changed; regenerate all fixtures and binding together.`);

const scope={tableId:table.id,periodStart:'2026-06-01',periodEnd:'2026-06-30',regions:[],complete:true,coverageNoteKey:'coverage.scheduledComplete'};
const snapshot=await analysis.analyze(table,{version:'1.0.0',confirmedScope:scope,samplePolicyId:'sample-manifest-v1'});

const canonical=v=>JSON.stringify(v,(k,x)=>x);
const payload={
  schemaVersion:'1.0.0',
  builtBy:'tooling/dataset/build_sample_snapshot.mjs',
  sourceFile:path.basename(sourcePath),
  sourceHash,
  sourceBytes:bytes.byteLength,
  normalizationRevision:table.normalizationRevision,
  analysisId:snapshot.id,
  seed:manifest.seed,
  snapshot,
};
await mkdir(path.dirname(outPath),{recursive:true});
await writeFile(outPath,canonical(payload)+'\n','utf8');
console.log(`Wrote ${outPath}`);
console.log(`analysisId=${snapshot.id} normalizationRevision=${table.normalizationRevision} sourceHash=${sourceHash}`);
