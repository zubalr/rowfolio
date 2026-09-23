/**
 * Workbook integration tests: build real workbooks from golden models and
 * inspect the OOXML independently (own ZIP reader, string-level XML
 * assertions — never ExcelJS read-back).
 */
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  AnalysisSnapshot,
  ExportModel,
  NormalizedTable,
  ScenarioResult,
} from '../../../packages/contracts/src/index.ts';
import { buildExportModel, exportFileName } from '../../../packages/export-model/src/index.ts';
import {
  assertSafeSheetName,
  buildWorkbook,
  escapeFormulaStringLiteral,
  ExportXlsxError,
  MAX_EXPORT_DATA_ROWS,
  validateModelLimits,
} from '../../../packages/export-xlsx/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', 'tests', 'contract', 'fixtures');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

const table = load<NormalizedTable>('normalized-table.example.json');
const snapshot = load<AnalysisSnapshot>('analysis-snapshot.example.json');
const scenario = load<ScenarioResult>('scenario-result.example.json');
const CREATED = '2026-09-20T00:00:00Z';

/** Minimal ZIP reader: central directory + stored/deflated entries. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number): number => view.getUint32(at, true);
  const u16 = (at: number): number => view.getUint16(at, true);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= 0; at -= 1) {
    if (u32(at) === 0x06054b50) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1) throw new Error('no end-of-central-directory record');
  const count = u16(eocd + 10);
  let at = u32(eocd + 16);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i += 1) {
    if (u32(at) !== 0x02014b50) throw new Error('bad central directory signature');
    const method = u16(at + 10);
    const compSize = u32(at + 24);
    const nameLen = u16(at + 28);
    const extraLen = u16(at + 30);
    const commentLen = u16(at + 32);
    const localOffset = u32(at + 42);
    const name = Buffer.from(bytes.subarray(at + 46, at + 46 + nameLen)).toString('utf8');
    const dataAt = (() => {
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('bad local header');
      const ln = view.getUint16(localOffset + 26, true);
      const le = view.getUint16(localOffset + 28, true);
      return localOffset + 30 + ln + le;
    })();
    const raw = bytes.subarray(dataAt, dataAt + compSize);
    out.set(name, method === 8 ? inflateRawSync(raw) : new Uint8Array(raw));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const textOf = (entries: Map<string, Uint8Array>, name: string): string =>
  Buffer.from(entries.get(name) as Uint8Array).toString('utf8');

/**
 * Relationship safety: every hyperlink target must be an in-workbook
 * `#fragment` (ExcelJS marks even those `TargetMode="External"`, which is
 * OOXML-correct for hyperlink rels); any other external mode or target
 * scheme fails. Unsafe part names fail too.
 */
function assertInternalLinksOnly(entries: Map<string, Uint8Array>): void {
  for (const [name, data] of entries) {
    const lower = name.toLowerCase();
    expect(lower.includes('vbaproject') || lower.includes('externallink') || lower.includes('oleobject')).toBe(false);
    if (!name.endsWith('.rels')) continue;
    const xml = Buffer.from(data).toString('utf8');
    for (const match of xml.matchAll(/<Relationship [^>]*>/g)) {
      const tag = match[0];
      const target = tag.match(/Target="([^"]*)"/)?.[1] ?? '';
      const isHyperlink = tag.includes('/hyperlink');
      expect(/^(https?:|mailto:|file:|ftp:)/i.test(target), `external target ${target}`).toBe(false);
      if (tag.includes('TargetMode="External"')) {
        expect(isHyperlink && target.startsWith('#'), `non-fragment external rel ${tag.slice(0, 120)}`).toBe(true);
      }
    }
  }
}

/** Decode the XML entities ExcelJS emits inside formula text. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function buildEn(): Promise<{ bytes: Uint8Array; model: ExportModel }> {
  const model = buildExportModel(snapshot, table, scenario, 'en', 'latn', CREATED);
  const stages: string[] = [];
  const artifact = await buildWorkbook(model, (stage) => {
    stages.push(stage);
  });
  expect(stages).toEqual(['model', 'layout', 'layout', 'tables', 'package', 'ready']);
  expect(artifact.metadata.format).toBe('xlsx');
  expect(artifact.metadata.mime).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  expect(artifact.metadata.byteLength).toBe(artifact.bytes.byteLength);
  expect(artifact.metadata.filename).toBe(exportFileName(model, 'xlsx'));
  const { createHash } = await import('node:crypto');
  expect(artifact.metadata.sha256).toBe(createHash('sha256').update(Buffer.from(artifact.bytes)).digest('hex'));
  return { bytes: new Uint8Array(artifact.bytes), model };
}

describe('workbook structure', () => {
  it('emits five safe sheets with tables, filters and frozen panes', async () => {
    const { bytes, model } = await buildEn();
    const entries = unzip(bytes);
    expect([...entries.keys()].filter((n) => n.startsWith('xl/worksheets/sheet'))).toHaveLength(5);
    const workbook = textOf(entries, 'xl/workbook.xml');
    for (const sheet of model.sheets) {
      expect(workbook).toContain(`name="${sheet.name}"`);
    }
    for (const name of ['CleanData', 'DataQuality', 'KpiAnalysis', 'Methodology']) {
      const found = [...entries.keys()].some(
        (n) => n.startsWith('xl/tables/') && textOf(entries, n).includes(`name="${name}"`),
      );
      expect(found, `table ${name}`).toBe(true);
    }
    const cleanSheet = textOf(entries, 'xl/worksheets/sheet2.xml');
    expect(cleanSheet).toContain('ySplit="1"');
    // Filters live inside the table parts only: a worksheet-level autoFilter
    // overlapping the table range is what Excel strips as broken content.
    expect(cleanSheet).not.toContain('<autoFilter');
    for (const path of [...entries.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
      expect(textOf(entries, path), `${path}: no sheet-level autoFilter`).not.toContain('<autoFilter');
    }
  });

  it('carries no external or unsafe references', async () => {
    const { bytes } = await buildEn();
    const entries = unzip(bytes);
    assertInternalLinksOnly(entries);
  });

  it('emits table parts spanning the laid-out rows and schema-ordered drawings', async () => {
    const { bytes } = await buildEn();
    const entries = unzip(bytes);
    // exceljs derives a table's ref from the rows passed to addTable, not from
    // cells written via addRow — header-only refs made Excel strip the tables
    // (and filters) in repair. Each part must cover its real range.
    const tableXml = (name: string): string => {
      const part = [...entries.keys()].find(
        (n) => n.startsWith('xl/tables/') && textOf(entries, n).includes(`name="${name}"`),
      );
      expect(part, `table part ${name}`).toBeDefined();
      return textOf(entries, part as string);
    };
    const refOf = (xml: string): string => /<table[^>]*\bref="([^"]+)"/.exec(xml)?.[1] ?? '';
    const filterRefOf = (xml: string): string => /<autoFilter[^>]*\bref="([^"]+)"/.exec(xml)?.[1] ?? '';
    const lastRow = (ref: string): number => Number(/(\d+)$/.exec(ref)?.[1]);

    const clean = tableXml('CleanData');
    expect(lastRow(refOf(clean))).toBe(table.rows.length + 1);
    expect(filterRefOf(clean)).toBe(refOf(clean));

    const quality = tableXml('DataQuality');
    expect(lastRow(refOf(quality))).toBe(table.qualityIssues.length + 1);
    expect(filterRefOf(quality)).toBe(refOf(quality));

    const kpis = tableXml('KpiAnalysis');
    expect(refOf(kpis)).toMatch(/^A1:D\d+$/);
    expect(lastRow(refOf(kpis))).toBeGreaterThan(1);
    expect(filterRefOf(kpis)).toBe(refOf(kpis));

    const method = tableXml('Methodology');
    // A valid range, never the A1:B0 collapse Excel rejected — and a real
    // header row so its autoFilter is legal in Excel's model.
    expect(refOf(method)).toMatch(/^A1:B[1-9]\d*$/);
    expect(method).toContain('headerRowCount="1"');
    expect(filterRefOf(method)).toBe(refOf(method));

    // legacyDrawing (cell-note VML) must precede tableParts — exceljs emits it
    // last, and strict parsers discard the entire sheet on that order.
    for (const path of [...entries.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
      const xml = textOf(entries, path);
      const drawingAt = xml.indexOf('<legacyDrawing');
      const partsAt = xml.indexOf('<tableParts');
      if (drawingAt !== -1 && partsAt !== -1) {
        expect(drawingAt, `${path}: legacyDrawing must precede tableParts`).toBeLessThan(partsAt);
      }
    }
  });

  it('links KPI labels to their methodology proofs', async () => {
    const { bytes } = await buildEn();
    const entries = unzip(bytes);
    const rels = [...entries.keys()]
      .filter((n) => n.startsWith('xl/worksheets/_rels/'))
      .map((n) => textOf(entries, n))
      .join('\n');
    // Local provenance links navigate inside the workbook, never outward.
    expect(rels).toContain('Target="#');
    expect(rels).toContain('Methodology');
  });

  it('writes a localized summary with assumptions separate from facts', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const model = buildExportModel(snapshot, table, scenario, locale, 'latn', CREATED);
      const artifact = await buildWorkbook(model, () => undefined);
      const entries = unzip(new Uint8Array(artifact.bytes));
      const strings = textOf(entries, 'xl/sharedStrings.xml');
      if (locale === 'en') {
        // The summary page opens on the report's cover identity, not the
        // dataset: title from the model's cover slide plus its context line.
        expect(strings).toContain('Monthly operations report');
        expect(strings).toContain('Example analysis');
        expect(strings).toContain('Revenue');
        expect(strings).toContain('Change operating costs');
        expect(strings).toContain('Includes the 8% operating-cost scenario.');
      } else {
        expect(strings).toContain('تقرير العمليات الشهري');
        expect(strings).toContain('الإيرادات');
      }
      // Print areas keep every sheet self-contained on paper.
      const workbook = textOf(entries, 'xl/workbook.xml');
      expect(workbook.match(/_xlnm\.Print_Area/g)?.length ?? 0).toBe(5);
    }
  });

  it('marks unresolved quality rows with restrained emphasis', async () => {
    const { bytes } = await buildEn();
    const entries = unzip(bytes);
    // Cell fills live in styles.xml; the sheet carries style indices.
    const styles = textOf(entries, 'xl/styles.xml');
    expect(styles).toContain('FFA33224');
    const quality = textOf(entries, 'xl/worksheets/sheet3.xml');
    // The styled header band sits in G1; below it, exactly the five
    // unresolved status cells carry a style (the adverse emphasis).
    const styled = quality.match(/<c r="G\d+" s="\d+"/g) ?? [];
    expect(styled.filter((c) => !c.includes('r="G1"')).length).toBe(5);
  });

  it('keeps clean-data rows and source coordinates in parity with the model', async () => {
    const { bytes, model } = await buildEn();
    const entries = unzip(bytes);
    const cleanSheet = textOf(entries, 'xl/worksheets/sheet2.xml');
    expect(cleanSheet).toContain('dimension ref="A1:N2401"');
    expect(cleanSheet).toContain('<c r="M2"');
    const strings = textOf(entries, 'xl/sharedStrings.xml');
    expect(strings).toContain('<t>source_row</t>');
    expect(strings).toContain('<t>record_id</t>');
    expect(model.table.rows).toHaveLength(2400);
  });

  it('writes cached template formulas whose results equal the model', async () => {
    const { bytes, model } = await buildEn();
    const entries = unzip(bytes);
    // Sheets are created in model order: summary, clean, quality, kpis, methodology.
    const kpi = textOf(entries, 'xl/worksheets/sheet4.xml');
    expect(kpi).toContain('<f>');
    expect(kpi).toContain('SUMIFS');
    expect(kpi).toContain('IF(');
    const revenue = model.metrics.find((m) => m.id === 'june-revenue');
    expect(kpi).toContain(`<v>${Number(revenue?.value as string)}</v>`);
  });

  it('stores hostile strings and long decimals as text, never formulas', async () => {
    const model = buildExportModel(snapshot, table, scenario, 'en', 'latn', CREATED);
    const poisoned: ExportModel = {
      ...model,
      table: {
        ...model.table,
        rows: model.table.rows.map((row, i) =>
          i === 0
            ? {
              ...row,
              values: {
                ...row.values,
                region: '=HYPERLINK("http://evil.invalid","x")',
                revenue: '12345678901234567890.12',
              },
            }
            : row,
        ),
      },
    };
    const artifact = await buildWorkbook(poisoned, () => undefined);
    const entries = unzip(new Uint8Array(artifact.bytes));
    const strings = textOf(entries, 'xl/sharedStrings.xml');
    expect(strings).toContain('=HYPERLINK(');
    expect(strings).toContain('12345678901234567890.12');
    for (const [name, data] of entries) {
      if (!name.startsWith('xl/worksheets/')) continue;
      const xml = Buffer.from(data).toString('utf8');
      for (const match of xml.matchAll(/<f>(.*?)<\/f>/g)) {
        expect(match[1]).not.toContain('HYPERLINK');
        expect(match[1]).not.toContain('12345678901234567890');
      }
    }
  });

  it('mirrors RTL worksheet views and translated sheets in Arabic', async () => {
    const model = buildExportModel(snapshot, table, scenario, 'ar', 'latn', CREATED);
    const artifact = await buildWorkbook(model, () => undefined);
    const entries = unzip(new Uint8Array(artifact.bytes));
    const workbook = textOf(entries, 'xl/workbook.xml');
    expect(workbook).toContain('name="البيانات المنقحة"');
    const cleanSheet = textOf(entries, 'xl/worksheets/sheet2.xml');
    expect(cleanSheet).toContain('rightToLeft="1"');
  });

  it('enforces limits and name safety without building', async () => {
    expect(() => assertSafeSheetName('ok name')).not.toThrow();
    for (const bad of ['a/b', 'x'.repeat(32), '[x]', '']) {
      expect(() => assertSafeSheetName(bad)).toThrow(ExportXlsxError);
    }
    const small = { table: { rows: [] } };
    expect(() => validateModelLimits(small as never)).not.toThrow();
    // Oversized tables fail fast with the typed limit error, before any
    // validation or allocation work happens.
    const base = buildExportModel(snapshot, table, scenario, 'en', 'latn', CREATED);
    const big = {
      ...base,
      table: {
        ...base.table,
        rows: Array.from({ length: MAX_EXPORT_DATA_ROWS + 1 }, (_, i) => ({
          id: `S0:R${i + 2}`,
          sourceRow: i + 2,
          sourceRefId: 'source-operations',
          values: {},
        })),
      },
    };
    expect(() => validateModelLimits(big)).toThrow(ExportXlsxError);
    await expect(buildWorkbook(big, () => undefined)).rejects.toThrow(ExportXlsxError);
  });

  it('keeps >15-digit metric decimals numeric with the exact value in a note', async () => {
    const { bytes } = await buildEn();
    const entries = unzip(bytes);
    const kpi = textOf(entries, 'xl/worksheets/sheet4.xml');
    const exact = '0.3107202680067001675041876046901172529313';
    // Numeric formula cell with the model's cached float result — not a
    // bare string and not silently skipped by the formula pass.
    const idx = kpi.indexOf(`<v>${Number(exact)}</v>`);
    expect(idx, 'numeric downtime-change result').toBeGreaterThan(-1);
    const rowXml = kpi.slice(kpi.lastIndexOf('<row', idx), kpi.indexOf('</row>', idx));
    expect(rowXml).toContain('<f>');
    expect(rowXml).toContain('IF(');
    // The canonical decimal survives verbatim in the cell's comment part
    // (and in the Methodology proof row, which is the provenance surface).
    const comments = [...entries.keys()]
      .filter((n) => n.startsWith('xl/comments'))
      .map((n) => textOf(entries, n))
      .join('\n');
    expect(comments).toContain(exact);
  });

  it('suppresses placeholder unit labels and falls back to ISO codes', async () => {
    const model = buildExportModel(snapshot, table, scenario, 'en', 'latn', CREATED);
    const mutated: ExportModel = {
      ...model,
      metrics: model.metrics.map((m) =>
        m.id === 'north-june-revenue' || m.id === 'north-june-orders'
          ? { ...m, unit: { ...m.unit, label: 'unit' } }
          : m,
      ),
    };
    const artifact = await buildWorkbook(mutated, () => undefined);
    const entries = unzip(new Uint8Array(artifact.bytes));
    const strings = textOf(entries, 'xl/sharedStrings.xml');
    // Placeholders never reach a cell; real labels and ISO codes do.
    expect(strings).not.toContain('<t>unit</t>');
    expect(strings).not.toContain('<t>fraction</t>');
    expect(strings).toContain('<t>USD</t>');
    expect(strings).toContain('<t>%</t>');
    expect(strings).toContain('<t>minutes</t>');
  });

  it('localizes KPI headers and coverage counts in Arabic', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const numbering = locale === 'ar' ? 'arab' : 'latn';
      const model = buildExportModel(snapshot, table, scenario, locale, numbering, CREATED);
      const artifact = await buildWorkbook(model, () => undefined);
      const entries = unzip(new Uint8Array(artifact.bytes));
      const strings = textOf(entries, 'xl/sharedStrings.xml');
      const tables = [...entries.keys()]
        .filter((n) => n.startsWith('xl/tables/'))
        .map((n) => textOf(entries, n))
        .join('\n');
      if (locale === 'en') {
        expect(strings).toContain('<t>Metric</t>');
        expect(strings).toContain('eligible ');
        expect(tables).toContain('name="Metric"');
      } else {
        expect(strings).toContain('المؤشر');
        expect(strings).toContain('الوحدة');
        expect(strings).toContain('التغطية');
        expect(strings).not.toContain('<t>Metric</t>');
        expect(strings).not.toContain('eligible ');
        // Coverage counts honor the Arabic numbering system.
        expect(strings).toMatch(/مؤهلة [٠-٩]+\/[٠-٩]+/);
        expect(tables).toContain('name="المؤشر"');
        expect(tables).not.toContain('name="Metric"');
      }
    }
  });

  it('escapes quotes in SUMIFS region criteria so hostile text stays one literal', async () => {
    expect(escapeFormulaStringLiteral('North')).toBe('North');
    expect(escapeFormulaStringLiteral('say "hi"')).toBe('say ""hi""');
    const hostile = 'x","1")+999*0+("';
    const model = buildExportModel(snapshot, table, scenario, 'en', 'latn', CREATED);
    const attacked: ExportModel = {
      ...model,
      metrics: model.metrics.map((m) =>
        m.id === 'north-june-revenue'
          ? { ...m, scope: { ...m.scope, regions: [hostile] } }
          : m,
      ),
    };
    const artifact = await buildWorkbook(attacked, () => undefined);
    const entries = unzip(new Uint8Array(artifact.bytes));
    const xml = [...entries.keys()]
      .filter((n) => n.startsWith('xl/worksheets/') && n.endsWith('.xml'))
      .map((n) => textOf(entries, n))
      .join('\n');
    const formulas = xml.match(/<f>[^<]*SUMIFS[^<]*<\/f>/g) ?? [];
    expect(formulas.length).toBeGreaterThan(0);
    // ExcelJS entity-encodes formula text; decode before asserting so the
    // check targets Excel semantics, not serialization artifacts.
    const decoded = formulas.map(decodeXmlEntities);
    const escaped = `"${hostile.replaceAll('"', '""')}"`;
    // The attacked metric's formula carries the escaped single literal…
    expect(decoded.some((f) => f.includes(escaped))).toBe(true);
    // …and no formula carries the raw hostile text as a broken-out literal.
    expect(decoded.every((f) => !f.includes(`"${hostile}"`))).toBe(true);
  });
});

// --- bounded recalculation engine ------------------------------------------
// Evaluates the exact formula grammar the writer emits (SUM/SUMIFS/IF/DATE,
// sheet-qualified ranges, comparisons, arithmetic, &) over the packaged cell
// grid, so formulas are verified against real data — not just their text.

type CellGrid = Map<string, number | string>;
type RangeRef = { sheet: string; c1: number; r1: number; c2: number; r2: number };
type EvalVal = number | string | RangeRef;

const colIndex = (letters: string): number =>
  letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (index: number): string => {
  let out = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};
const addrOf = (ref: string): [number, number] => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.replace(/\$/g, ''));
  if (m === null) throw new Error(`bad cell ref ${ref}`);
  return [colIndex(m[1] as string), Number(m[2])];
};

function evalFormula(source: string, home: string, grids: ReadonlyMap<string, CellGrid>): number | string {
  const tokens =
    source.match(
      /'[^']*'!|\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+|\$?[A-Z]+\$?\d+|"[^"]*"|\d+\.\d+|\d+|>=|<=|<>|>|<|=|\+|-|\*|\/|&|\(|\)|,|[A-Za-z_]+/g,
    ) ?? [];
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const num = (v: EvalVal): number => (typeof v === 'number' ? v : Number(v) || 0);
  const cellAt = (sheet: string, addr: string): number | string | undefined => grids.get(sheet)?.get(addr);
  const cellsOf = (r: RangeRef): Array<number | string | undefined> => {
    const g = grids.get(r.sheet);
    const out: Array<number | string | undefined> = [];
    if (g === undefined) return out;
    for (let rr = r.r1; rr <= r.r2; rr += 1) {
      for (let cc = r.c1; cc <= r.c2; cc += 1) out.push(g.get(`${colName(cc)}${rr}`));
    }
    return out;
  };
  const refOf = (sheet: string, tok: string): EvalVal => {
    const [a, b] = tok.split(':');
    if (b === undefined) return cellAt(sheet, a.replace(/\$/g, '')) ?? 0;
    const [c1, r1] = addrOf(a as string);
    const [c2, r2] = addrOf(b);
    return { sheet, c1, r1, c2, r2 };
  };
  const matches = (cell: number | string | undefined, criterion: EvalVal): boolean => {
    if (typeof criterion === 'number') return cell === criterion;
    const m = /^(>=|<=|<>|>|<|=)?(.*)$/.exec(String(criterion));
    const op = m?.[1] ?? '=';
    const rest = m?.[2] ?? '';
    if (rest === '' || Number.isNaN(Number(rest))) {
      return op === '=' && String(cell ?? '') === rest;
    }
    if (typeof cell !== 'number') return false;
    const n = Number(rest);
    switch (op) {
      case '>=': return cell >= n;
      case '<=': return cell <= n;
      case '>': return cell > n;
      case '<': return cell < n;
      case '<>': return cell !== n;
      default: return cell === n;
    }
  };
  const call = (name: string, args: EvalVal[]): EvalVal => {
    switch (name.toUpperCase()) {
      case 'DATE':
        return Math.round(Date.UTC(num(args[0] as EvalVal), num(args[1] as EvalVal) - 1, num(args[2] as EvalVal)) / 86400000) + 25569;
      case 'IF':
        return num(args[0] as EvalVal) !== 0 ? (args[1] as EvalVal) : ((args[2] as EvalVal) ?? '');
      case 'SUM': {
        let total = 0;
        for (const a of args) {
          for (const v of typeof a === 'object' ? cellsOf(a) : [a]) if (typeof v === 'number') total += v;
        }
        return total;
      }
      case 'SUMIFS': {
        const sumRange = args[0] as RangeRef;
        const sumCells = cellsOf(sumRange);
        const pairs: Array<[RangeRef, EvalVal]> = [];
        for (let i = 1; i + 1 < args.length; i += 2) pairs.push([args[i] as RangeRef, args[i + 1] as EvalVal]);
        const critCells = pairs.map(([r]) => cellsOf(r));
        let total = 0;
        for (let i = 0; i < sumCells.length; i += 1) {
          const ok = pairs.every(([, crit], p) => matches(critCells[p]?.[i], crit));
          const v = sumCells[i];
          if (ok && typeof v === 'number') total += v;
        }
        return total;
      }
      default:
        throw new Error(`unsupported function ${name}`);
    }
  };
  const parsePrimary = (): EvalVal => {
    const t = tokens[pos++];
    if (t === undefined) return 0;
    if (t === '(') {
      const v = parseConcat();
      pos += 1; // ')'
      return v;
    }
    if (t === '-') return -num(parsePrimary());
    if (t.startsWith('"')) return t.slice(1, -1);
    if (t.startsWith("'")) {
      const sheet = t.slice(1).replace(/'!$/, '');
      return refOf(sheet, tokens[pos++] as string);
    }
    if (/^[0-9]/.test(t)) return Number(t);
    if (/^[A-Za-z_]+$/.test(t)) {
      pos += 1; // '('
      const args: EvalVal[] = [];
      while (peek() !== ')') {
        if (peek() === ',') pos += 1;
        else args.push(parseConcat());
      }
      pos += 1; // ')'
      return call(t, args);
    }
    return refOf(home, t);
  };
  const parseTerm = (): EvalVal => {
    let v = parsePrimary();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[pos++];
      v = op === '*' ? num(v) * num(parsePrimary()) : num(v) / num(parsePrimary());
    }
    return v;
  };
  const parseArith = (): EvalVal => {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos++];
      v = op === '+' ? num(v) + num(parseTerm()) : num(v) - num(parseTerm());
    }
    return v;
  };
  const parseCmp = (): EvalVal => {
    const v = parseArith();
    const op = peek();
    if (op === '>' || op === '<' || op === '>=' || op === '<=' || op === '=' || op === '<>') {
      pos += 1;
      const l = num(v);
      const r = num(parseArith());
      const ok =
        op === '>' ? l > r : op === '<' ? l < r : op === '>=' ? l >= r : op === '<=' ? l <= r : op === '=' ? l === r : l !== r;
      return ok ? 1 : 0;
    }
    return v;
  };
  const parseConcat = (): EvalVal => {
    let v = parseCmp();
    while (peek() === '&') {
      pos += 1;
      v = `${String(v as number | string)}${String(parseCmp() as number | string)}`;
    }
    return v;
  };
  const result = parseConcat();
  if (typeof result === 'object') throw new Error('formula produced a bare range');
  return result;
}

/** Cell grid per sheet name, resolved through workbook.xml + its rels. */
function workbookGrids(entries: ReadonlyMap<string, Uint8Array>): {
  grids: Map<string, CellGrid>;
  pathByName: Map<string, string>;
  sharedStrings: string[];
} {
  const stringsXml = textOf(entries, 'xl/sharedStrings.xml');
  const sharedStrings = [...stringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeXmlEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  const rels = textOf(entries, 'xl/_rels/workbook.xml.rels');
  const ridToTarget = new Map(
    [...rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2] as string]),
  );
  const wb = textOf(entries, 'xl/workbook.xml');
  const pathByName = new Map<string, string>();
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const target = ridToTarget.get(m[2] as string);
    if (target !== undefined) pathByName.set(decodeXmlEntities(m[1] as string), `xl/${target}`);
  }
  const grids = new Map<string, CellGrid>();
  for (const [name, path] of pathByName) {
    const xml = textOf(entries, path);
    const grid: CellGrid = new Map();
    for (const c of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const v = /<v>([^<]*)<\/v>/.exec(c[3] as string)?.[1];
      if (v === undefined) continue;
      grid.set(c[1] as string, (c[2] as string).includes('t="s"') ? (sharedStrings[Number(v)] ?? '') : Number(v));
    }
    grids.set(name, grid);
  }
  return { grids, pathByName, sharedStrings };
}

describe('workbook formula recalculation', () => {
  it('recalculates every emitted KPI formula to the model oracle over real serial dates', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const model = buildExportModel(snapshot, table, scenario, locale, locale === 'ar' ? 'arab' : 'latn', CREATED);
      const artifact = await buildWorkbook(model, () => undefined);
      const entries = unzip(new Uint8Array(artifact.bytes));
      const { grids, pathByName } = workbookGrids(entries);
      const nameOf = (id: string): string =>
        model.sheets.find((s) => s.id === id)?.name ?? id;

      // Serial dates, not ISO shared strings: B is the sample's date column.
      const cleanXml = textOf(entries, pathByName.get(nameOf('clean')) as string);
      const dateCell = /<c r="B2"([^>]*)>([\s\S]*?)<\/c>/.exec(cleanXml);
      expect(dateCell?.[0] ?? '').not.toContain('t="s"');
      expect(Number(/<v>([^<]+)/.exec(dateCell?.[2] ?? '')?.[1]), 'B2 serial').toBeGreaterThan(40000);

      const kpiName = nameOf('kpis');
      const kpiXml = textOf(entries, pathByName.get(kpiName) as string);
      // No bare whole-column SUMs; every summed metric is date-bounded.
      expect(/\bSUM\(/.test(decodeXmlEntities(kpiXml)), 'unbounded SUM emitted').toBe(false);
      const formulas = new Map<string, string>();
      for (const c of kpiXml.matchAll(/<c r="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/c>/g)) {
        const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(c[2] as string)?.[1];
        if (f !== undefined) formulas.set(c[1] as string, decodeXmlEntities(f));
      }
      const dataMetrics = model.metrics.filter((m) => !m.id.startsWith('quality-'));
      dataMetrics.forEach((metric, i) => {
        const f = formulas.get(`B${i + 2}`);
        if (f === undefined || metric.value === null) return;
        const got = evalFormula(f, kpiName, grids);
        expect(got, `${locale}/${metric.id}: ${f}`).toBeCloseTo(Number(metric.value), 6);
      });
    }
  });

  it('lands every proof link on its matching Methodology proof label', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const model = buildExportModel(snapshot, table, scenario, locale, locale === 'ar' ? 'arab' : 'latn', CREATED);
      const artifact = await buildWorkbook(model, () => undefined);
      const entries = unzip(new Uint8Array(artifact.bytes));
      const { grids, pathByName } = workbookGrids(entries);
      const nameOf = (id: string): string => model.sheets.find((s) => s.id === id)?.name ?? id;
      const methodGrid = grids.get(nameOf('methodology'));
      const dataMetrics = model.metrics.filter((m) => !m.id.startsWith('quality-'));
      const proofIds = new Set(model.provenance.map((p) => p.id));
      const labelOf = (addr: string): string => {
        const v = methodGrid?.get(addr);
        return typeof v === 'string' ? v : '';
      };
      const labelFor = (id: string): string =>
        (locale === 'ar' ? 'إثبات' : 'Proof') + ` ${id}`;

      // KPI sheet: each metric row's A-cell link must land on THAT metric's proof.
      const kpiXml = textOf(entries, pathByName.get(nameOf('kpis')) as string);
      let kpiLinks = 0;
      for (const m of kpiXml.matchAll(/<hyperlink ref="A(\d+)"[^>]*location="#[^!]+!A(\d+)"/g)) {
        kpiLinks += 1;
        const metric = dataMetrics[Number(m[1]) - 2];
        expect(metric, `link at KPI row ${m[1]}`).toBeDefined();
        const want = labelFor(metric?.provenanceId ?? '');
        expect(labelOf(`A${m[2]}`), `${locale}/${metric?.id} -> A${m[2]}`).toBe(want);
      }
      expect(kpiLinks).toBeGreaterThan(0);

      // Summary sheet: every link must land on some real proof label, never a
      // fixed metadata row (the stale 9+i bug landed on Template/Locale).
      const summaryXml = textOf(entries, pathByName.get(nameOf('summary')) as string);
      const summaryLinks = [...summaryXml.matchAll(/<hyperlink ref="A\d+"[^>]*location="#[^!]+!A(\d+)"/g)];
      expect(summaryLinks.length).toBeGreaterThan(0);
      for (const m of summaryLinks) {
        const text = labelOf(`A${m[1]}`);
        expect(
          [...proofIds].some((id) => text === labelFor(id)),
          `${locale} summary link -> A${m[1]} (${text})`,
        ).toBe(true);
      }
    }
  });

  it('preserves malformed date-typed values as verbatim text, never rolled or Invalid Date', async () => {
    // Profiling can leave minority malformed cells in a date-typed column;
    // export must not silently rewrite them into different dates.
    const modified: NormalizedTable = {
      ...table,
      rows: [
        ...table.rows,
        { ...table.rows[0]!, id: 'S0:R9998', sourceRow: 9998, values: { ...table.rows[0]!.values, date: '2026-02-31' } },
        { ...table.rows[0]!, id: 'S0:R9999', sourceRow: 9999, values: { ...table.rows[0]!.values, date: 'not-a-date' } },
      ],
    };
    const model = buildExportModel(snapshot, modified, scenario, 'en', 'latn', CREATED);
    const artifact = await buildWorkbook(model, () => undefined);
    const entries = unzip(new Uint8Array(artifact.bytes));
    const { grids, pathByName } = workbookGrids(entries);
    const cleanXml = textOf(entries, pathByName.get(model.sheets.find((s) => s.id === 'clean')?.name ?? 'clean') as string);
    expect(cleanXml).not.toContain('NaN');

    const cleanGrid = grids.get(model.sheets.find((s) => s.id === 'clean')?.name ?? 'clean');
    const lastTwo = modified.rows.length + 1; // appended rows sit at the end
    expect(cleanGrid?.get(`B${lastTwo - 1}`)).toBe('2026-02-31');
    expect(cleanGrid?.get(`B${lastTwo}`)).toBe('not-a-date');
    // A valid date in the same column still serializes as a number.
    const dateCell = /<c r="B2"([^>]*)>([\s\S]*?)<\/c>/.exec(cleanXml);
    expect(dateCell?.[0] ?? '').not.toContain('t="s"');
    expect(Number(/<v>([^<]+)/.exec(dateCell?.[2] ?? '')?.[1])).toBeGreaterThan(40000);
  });
});
