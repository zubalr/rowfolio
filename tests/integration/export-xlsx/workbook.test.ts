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
import { buildExportModel } from '../../../packages/export-model/src/index.ts';
import {
  assertSafeSheetName,
  buildWorkbook,
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
  expect(artifact.metadata.filename).toBe(`rowfolio-${model.exportId}.xlsx`);
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
    expect(cleanSheet).toContain('autoFilter');
  });

  it('carries no external or unsafe references', async () => {
    const { bytes } = await buildEn();
    const entries = unzip(bytes);
    for (const [name, data] of entries) {
      const lower = name.toLowerCase();
      expect(lower.includes('vbaproject') || lower.includes('externallink') || lower.includes('oleobject')).toBe(false);
      if (name.endsWith('.rels')) {
        expect(Buffer.from(data).toString('utf8')).not.toContain('TargetMode="External"');
      }
    }
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
});
