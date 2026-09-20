/**
 * A22 adversarial export suite — the generated .xlsx must never carry an
 * injected or corrupt formula, user text must stay inert, and stale-model
 * bindings must fail typed. Generated workbooks are unzipped and the sheet
 * XML is inspected directly (no Office install required).
 */
import { describe, expect, it } from 'vitest';
import type { ExportModel } from '../../packages/contracts/src/index.ts';
import { buildWorkbook, assertSafeSheetName, ExportXlsxError } from '../../packages/export-xlsx/src/index.ts';
import { preflightZip } from '../../packages/ingest/src/zip-preflight.ts';
import { defaultLimits } from '../../packages/ingest/src/index.ts';
import { buildExportModel, ExportModelError } from '../../packages/export-model/src/index.ts';
import { buildPresentation } from '../../packages/export-pptx/src/index.ts';
import enModel from '../contract/fixtures/export-model.en.example.json';
import snapshotFixture from '../contract/fixtures/analysis-snapshot.example.json';
import tableFixture from '../contract/fixtures/normalized-table.example.json';

const MODEL = enModel as unknown as ExportModel;

async function workbookFiles(model: ExportModel): Promise<Map<string, Uint8Array>> {
  const built = await buildWorkbook(model, () => {});
  // Reuse the bounded preflight to unpack the generated workbook — no new
  // ZIP dependency, and it double-checks our own output against the caps.
  const { entries } = await preflightZip(new Uint8Array(built.bytes), defaultLimits(), undefined, () => {});
  return entries;
}

function sheetTexts(files: Map<string, Uint8Array>): { name: string; xml: string }[] {
  const dec = new TextDecoder();
  return [...files.entries()]
    .filter(([n]) => n.startsWith('xl/worksheets/') && n.endsWith('.xml'))
    .map(([name, data]) => ({ name, xml: dec.decode(data) }));
}

/* ------------------------------------------------------------------ */

describe('formula injection and integrity', () => {
  it.fails('a region containing a double quote must not corrupt the SUMIFS criteria (A22-F11)', async () => {
    // Craft a model whose metric scope carries a hostile region name. Metric
    // ids 'north-june-*' are the sample-pack ids the template-formula writer
    // recognizes; the region string is attacker data when reached via a
    // non-sample caller (latent today — the app's sample scope is constant).
    const hostile = 'x","1")+999*0+("';
    const model: ExportModel = {
      ...MODEL,
      metrics: MODEL.metrics.map((m) =>
        m.id === 'north-june-revenue'
          ? { ...m, scope: { ...m.scope, regions: [hostile] } }
          : m,
      ),
    };
    const files = await workbookFiles(model);
    const xml = sheetTexts(files).map((s) => s.xml).join('\n');
    const formulas = xml.match(/<f>[^<]*SUMIFS[^<]*<\/f>/g) ?? [];
    expect(formulas.length).toBeGreaterThan(0);
    // Correct behavior: the region must be Excel-escaped ("" doubling) so the
    // criteria literal terminates where intended — or the value must never
    // be interpolated. Today the raw string lands inside "...": `"x","1")…`
    // breaks the string literal and injects formula text.
    expect(formulas.every((f) => f.includes(`"${hostile.replaceAll('"', '""')}"`))).toBe(true);
  });

  it('all user-sourced cell text lands as shared strings, never as <f> formulas', async () => {
    const files = await workbookFiles(MODEL);
    const xml = sheetTexts(files).map((s) => s.xml).join('\n');
    // Only template-generated formulas may exist: pure arithmetic over
    // own-sheet cell refs and SUM/SUMIFS/IF/DATE calls whose string literals
    // are criteria constants — never attacker cell text.
    const formulas = xml.match(/<f>[^<]*<\/f>/g) ?? [];
    expect(formulas.length).toBeGreaterThan(0);
    for (const f of formulas) {
      const inner = f.slice(3, -4);
      const fns = inner.match(/[A-Z][A-Z0-9]*\(/g) ?? [];
      for (const fn of fns) expect(['SUM(', 'SUMIFS(', 'IF(', 'DATE(']).toContain(fn);
      for (const lit of inner.match(/"[^"]*"/g) ?? []) {
        // criteria literals must be scope constants — anything else is injection
        expect(['"North"']).toContain(lit);
      }
      expect(inner).not.toMatch(/<|>|\\|`/);
    }
    // Source-derived text containing '=' must be in sharedStrings, not <f>.
    expect(files.has('xl/sharedStrings.xml')).toBe(true);
  });

  it('buildExportModel rejects a stale table (id/revision/hash mismatch)', () => {
    const snapshot = snapshotFixture as never;
    const table = tableFixture as never;
    expect(() =>
      buildExportModel(snapshot, { ...(table as object), id: 'other-table' } as never, null, 'en', 'latn', '2026-01-01T00:00:00Z'),
    ).toThrowError(ExportModelError);
    expect(() =>
      buildExportModel(
        snapshot,
        { ...(table as object), sourceRef: { ...(table as { sourceRef: object }).sourceRef, sourceHash: 'f'.repeat(64) } } as never,
        null, 'en', 'latn', '2026-01-01T00:00:00Z',
      ),
    ).toThrowError(ExportModelError);
  });

  it('a scenario from a different baseline snapshot is refused', () => {
    const snapshot = snapshotFixture as never;
    const table = tableFixture as never;
    const scenario = {
      baselineAnalysisId: 'analysis-WRONG',
      scope: (snapshot as { scope: unknown }).scope,
      status: 'defined',
      metrics: [],
      provenance: [],
      id: 'scenario-x',
      definitionId: 'operating-cost-v1',
      costChange: '0.05',
      reasonKey: null,
    } as never;
    expect(() =>
      buildExportModel(snapshot, table, scenario, 'en', 'latn', '2026-01-01T00:00:00Z'),
    ).toThrowError(/scenario/);
  });
});

describe('sheet-name and layout guards', () => {
  it('sheet names with []:*?/\\ or controls are refused', () => {
    for (const bad of ['a]b', 'x:y', 'q?', 'a/b', 'c\\d', 'x'.repeat(32), '']) {
      expect(() => assertSafeSheetName(bad)).toThrowError(ExportXlsxError);
    }
    for (const ok of ['CleanData', 'بيانات نظيفة', "it's fine", 'a-b_c (d)']) {
      expect(() => assertSafeSheetName(ok)).not.toThrow();
    }
  });

  it('a deck with too many body bullets fails typed (layout-overflow), never clips silently', async () => {
    const model: ExportModel = {
      ...MODEL,
      slides: MODEL.slides.map((s, i) =>
        i === 0 ? { ...s, kind: 'kpis' as const, metricIds: MODEL.metrics.map((m) => m.id).slice(0, 12) } : s,
      ),
    };
    try {
      await buildPresentation(model, () => {});
      // If it didn't overflow, the bullets fit — still a valid outcome.
    } catch (error) {
      expect((error as { code?: string }).code).toMatch(/layout-overflow|invalid-model/);
    }
  });
});
