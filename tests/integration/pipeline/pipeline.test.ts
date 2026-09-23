/**
 * End-to-end pipeline hardening: real CSV bytes through the owned
 * normalize → analysis → scenario → export-model → XLSX/PPTX path, with
 * a pinned Decimal oracle, provenance continuity, determinism checks,
 * real artifact inspection, and a machine-readable report.
 *
 * Expected totals are pinned literals cross-checked with an independent
 * Python Decimal computation (amount `1000000000000001234567890123655.74`,
 * cost `193.00`), never values copied from a previous run.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
  buildEvalContext,
  checkAnalysisSnapshot,
  checkExportModel,
  checkScenarioResult,
  compareDecimal,
  evaluateMetric,
} from '../../../packages/contracts/src/index.ts';
import { buildExportModel, numericParity } from '../../../packages/export-model/src/index.ts';
import { ExportModelError } from '../../../packages/export-model/src/index.ts';
import { originalValue } from '../../../packages/normalize/src/index.ts';
import { CREATED_AT, edgeApprovals, edgeDefinition, edgeRaw, edgeScope } from './fixtures.ts';
import { runPipeline, type PipelineResult } from './pipeline.ts';
import { entryText, structuralDigest, unzip } from './zip.ts';
import { writeArtifact, writeReport, type ReportArtifact, type ReportCheck } from './report.ts';

const checks: ReportCheck[] = [];
const artifacts: ReportArtifact[] = [];

function check(id: string, passed: boolean, detail: string): void {
  checks.push({ id, passed, detail });
  expect(passed, `${id}: ${detail}`).toBe(true);
}

let first: PipelineResult;

beforeAll(async () => {
  const raw = edgeRaw();
  first = await runPipeline({
    raw,
    approvals: edgeApprovals(raw),
    scope: edgeScope(),
    definition: edgeDefinition(),
    costChange: '0.10',
    createdAt: CREATED_AT,
  });
}, 120000);

describe('ledger and cleanup oracle', () => {
  it('traces every edge case with exact counts', () => {
    const kinds = first.table.qualityIssues.map((q) => q.kind).sort();
    // The 32-significant-digit cell trips the 30-digit input envelope and
    // is traced as precision — then still aggregates exactly.
    check('ledger-shape', JSON.stringify(kinds) === JSON.stringify([
      'ambiguous-date', 'category', 'duplicate', 'malformed', 'malformed',
      'missing', 'missing', 'precision',
    ]), `ledger kinds: ${kinds.join(',')}`);
    const ids = new Set(first.table.qualityIssues.map((q) => q.id));
    check('ledger-ids', ['quality-duplicate-14', 'quality-category-7', 'quality-missing-8',
      'quality-malformed-9-c4', 'quality-malformed-13-c4'].every((id) => ids.has(id)),
    'duplicate/category/missing/malformed ids present');
  });

  it('retains 12 rows, excludes the duplicate, reverses the category map', () => {
    check('retained-rows', first.table.rows.length === 12, `${first.table.rows.length} retained`);
    check('dup-excluded', !first.table.rows.some((r) => r.sourceRow === 14), 'row 14 excluded');
    check('reversibility', originalValue(first.table, 7, 'region') === 'north ', 'raw cell recoverable');
    check('rtl-preserved', first.table.rows.some((r) => r.values['region'] === 'الجنوب'), 'RTL region kept, never merged');
  });
});

describe('aggregation and scenario oracle', () => {
  it('sums the shared masks to the pinned totals', () => {
    const byId = new Map(first.snapshot.metrics.map((m) => [m.id, m] as const));
    const revenue = byId.get('total-revenue');
    const cost = byId.get('total-operating_cost');
    check('revenue-total', revenue?.value === '1000000000000001234567890123655.74', `revenue=${revenue?.value}`);
    check('revenue-eligible', revenue?.eligibleRows === 7 && revenue?.totalRows === 10, 'eligible 7/10');
    check('cost-total', cost?.value === '193.00', `cost=${cost?.value}`);
    check('cost-eligible', cost?.eligibleRows === 10 && cost?.totalRows === 10, 'eligible 10/10');
    // `tip` is a confirmed measure without a catalog key: no exportable
    // metric is minted for it (a catalog gap, never invented copy).
    check('catalog-key-gate', !byId.has('total-tip'), 'keyless measures stay in the table only');
  });

  it('recomputes every proof from clean cells', () => {
    const ctx = buildEvalContext(first.table, first.snapshot.metrics, first.snapshot.provenance);
    for (const metric of first.snapshot.metrics) {
      if (metric.status !== 'defined' || metric.value === null) continue;
      const outcome = evaluateMetric(metric.id, ctx, [], `/${metric.id}`);
      const ok = outcome.status === 'defined' && compareDecimal(outcome.value, metric.value) === 0;
      check(`proof:${metric.id}`, ok, `recomputed ${outcome.status === 'defined' ? outcome.value : outcome.status}`);
    }
    check('snapshot-valid', checkAnalysisSnapshot(first.snapshot, { table: first.table }).length === 0, 'validator clean');
  });

  it('runs the cost scenario with exact money arithmetic', () => {
    check('scenario-defined', first.scenario.status === 'defined', first.scenario.status);
    const byId = new Map(first.scenario.metrics.map((m) => [m.id, m] as const));
    check('scenario-cost', byId.get('scenario-cost')?.value === '212.30', `cost=${byId.get('scenario-cost')?.value}`);
    const issues = checkScenarioResult(first.scenario, {
      snapshot: first.snapshot, definition: edgeDefinition(), table: first.table,
    });
    check('scenario-valid', issues.length === 0, issues.map((i) => i.rule).join(','));
  });
});

describe('export continuity and artifacts', () => {
  it('preserves values and provenance into the export model', () => {
    check('revision-continuity',
      first.modelEn.table.normalizationRevision === first.snapshot.normalizationRevision,
      'revision frozen across export');
    check('numeric-parity', numericParity(first.modelEn).length === 0, 'charts equal metrics');
    check('export-valid', checkExportModel(first.modelEn, {
      snapshot: first.snapshot, scenario: first.scenario, table: first.table,
    }).length === 0, 'validator clean');
    const stale = {
      ...first.table,
      rows: first.table.rows.map((r, i) => (i === 0 ? { ...r, values: { ...r.values, revenue: '1.00' } } : r)),
      normalizationRevision: '0'.repeat(64),
    };
    let threw = false;
    try {
      buildExportModel(first.snapshot, stale, first.scenario, 'en', 'latn', CREATED_AT);
    } catch (error) {
      threw = error instanceof ExportModelError;
    }
    check('stale-rejected', threw, 'mutated revision refused');
  });

  it('produces inspectable XLSX and PPTX artifacts', () => {
    const xlsxBytes = new Uint8Array(first.xlsx.bytes);
    const pptxBytes = new Uint8Array(first.pptx.bytes);
    artifacts.push(writeArtifact(`pipeline-${first.modelEn.exportId}.xlsx`, xlsxBytes));
    artifacts.push(writeArtifact(`pipeline-${first.modelEn.exportId}.pptx`, pptxBytes));
    check('xlsx-meta', first.xlsx.metadata.byteLength === xlsxBytes.byteLength
      && first.xlsx.metadata.sha256.length === 64, 'metadata matches bytes');

    const xlsx = unzip(xlsxBytes);
    const sheets = [...xlsx.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    check('xlsx-sheets', sheets.length === 5, `${sheets.length} sheets`);
    const clean = entryText(xlsx, 'xl/worksheets/sheet2.xml');
    check('xlsx-clean-dim', clean.includes('dimension ref="A1:K13"'), '12 rows + header over 11 columns');
    check('xlsx-source-rows', clean.includes('<c r="J13"><v>13</v></c>') && !clean.includes('S0:R14'),
      'source rows preserved, duplicate absent');
    const strings = entryText(xlsx, 'xl/sharedStrings.xml');
    check('xlsx-injection-text', strings.includes('=SUM(A1:A2)'), 'formula-like text stored as string');
    let formulaLeak = false;
    for (const [name, data] of xlsx) {
      if (!name.startsWith('xl/worksheets/')) continue;
      const xml = Buffer.from(data).toString('utf8');
      for (const match of xml.matchAll(/<f>(.*?)<\/f>/g)) {
        if ((match[1] as string).includes('SUM(A1:A2)')) formulaLeak = true;
      }
      if (name.endsWith('.rels') && hasExternalTarget(xml)) formulaLeak = true;
    }
    check('xlsx-no-leak', !formulaLeak, 'no user text in formulas or external rels');

    const pptx = unzip(pptxBytes);
    const slides = [...pptx.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    check('pptx-slides', slides.length === 6, `${slides.length} slides`);
    const notes = [...pptx.keys()].filter((n) => n.startsWith('ppt/notesSlides/'))
      .map((n) => entryText(pptx, n)).join('\n');
    check('pptx-notes', notes.includes('finding:finding-quality'), 'lead finding id in notes');
    let external = false;
    for (const [name, data] of pptx) {
      if (name.endsWith('.rels') && hasExternalTarget(Buffer.from(data).toString('utf8'))) external = true;
    }
    check('pptx-no-external', !external, 'no external relationships');
  });

  it('is deterministic across repeated runs', async () => {
    const raw = edgeRaw();
    const second = await runPipeline({
      raw, approvals: edgeApprovals(raw), scope: edgeScope(),
      definition: edgeDefinition(), costChange: '0.10', createdAt: CREATED_AT,
    });
    check('repeat-table', JSON.stringify(second.table) === JSON.stringify(first.table), 'table identical');
    check('repeat-snapshot', JSON.stringify(second.snapshot) === JSON.stringify(first.snapshot), 'snapshot identical');
    check('repeat-model', JSON.stringify(second.modelEn) === JSON.stringify(first.modelEn), 'model identical');
    const xlsxSame = structuralDigest(unzip(new Uint8Array(second.xlsx.bytes)))
      === structuralDigest(unzip(new Uint8Array(first.xlsx.bytes)));
    // PptxGenJS numbers chart parts from process-global state, so repeat
    // builds name them chart1/chart2/... differently. Normalize those
    // names (keys and references) before comparing semantic structure.
    const pptxSame = structuralDigest(normalizeChartParts(unzip(new Uint8Array(second.pptx.bytes))))
      === structuralDigest(normalizeChartParts(unzip(new Uint8Array(first.pptx.bytes))));
    check('repeat-xlsx-structure', xlsxSame, 'workbook structure identical');
    check('repeat-pptx-structure', pptxSame, 'deck structure identical');
    const xlsxBytesEqual = Buffer.from(second.xlsx.bytes).equals(Buffer.from(first.xlsx.bytes));
    const pptxBytesEqual = Buffer.from(second.pptx.bytes).equals(Buffer.from(first.pptx.bytes));
    checks.push({
      id: 'repeat-bytes',
      passed: true,
      detail: `byte-identical: xlsx=${xlsxBytesEqual} pptx=${pptxBytesEqual} (informational; structure is the gate)`,
    });
  }, 120000);

  it('disables the scenario on zero revenue instead of dividing', async () => {
    const raw = edgeRaw();
    const zeroed: typeof raw = {
      ...raw,
      cells: raw.cells.map((c) => (c.column === 4 && c.row > 1 ? { ...c, raw: '0' } : c)),
    };
    const result = await runPipeline({
      raw: zeroed, approvals: edgeApprovals(zeroed), scope: edgeScope(),
      definition: edgeDefinition(), costChange: '0.10', createdAt: CREATED_AT,
    });
    check('zero-unavailable', result.scenario.status === 'unavailable'
      && result.scenario.reasonKey === 'scenario.zeroRevenue', result.scenario.reasonKey ?? 'defined');
  }, 120000);
});

describe('pipeline report', () => {
  it('writes the machine-readable report', () => {
    const path = writeReport(checks, artifacts);
    check('report-written', path.endsWith('report.json'), path);
  });
});

/**
 * Normalize writer-assigned nondeterminism for structural comparison:
 * chart/worksheet part numbers come from process-global library state,
 * core properties carry wall-clock timestamps, and the embedded
 * chart-data workbooks are writer-managed caches with their own
 * timestamps. None is semantic content — and the chart values themselves
 * are asserted separately against the model — so embeddings are excluded
 * while everything else must be identical across repeat builds.
 */
function hasExternalTarget(xml: string): boolean {
  for (const match of xml.matchAll(/<Relationship [^>]*>/g)) {
    const tag = match[0];
    const target = tag.match(/Target="([^"]*)"/)?.[1] ?? '';
    if (/^(https?:|mailto:|file:|ftp:)/i.test(target)) return true;
    if (tag.includes('TargetMode="External"')) {
      const isFragmentLink = tag.includes('/hyperlink') && target.startsWith('#');
      if (!isFragmentLink) return true;
    }
  }
  return false;
}

function normalizeChartParts(entries: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const scrub = (text: string): string => text
    .replace(/chart\d+/g, 'chart#')
    .replace(/Worksheet\d+/g, 'Worksheet#')
    .replace(/<dcterms:(created|modified)[^>]*>.*?<\/dcterms:(created|modified)>/g, '<dcterms:$1>FIXED</dcterms:$1>');
  const normalized = new Map<string, Uint8Array>();
  for (const [name, data] of entries) {
    if (name.startsWith('ppt/embeddings/')) continue;
    const text = tryDecode(data);
    if (text === null) {
      normalized.set(scrub(name), data);
    } else {
      normalized.set(scrub(name), new TextEncoder().encode(scrub(text)));
    }
  }
  return normalized;
}

function tryDecode(data: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    return text.includes('<') ? text : null;
  } catch {
    return null;
  }
}
