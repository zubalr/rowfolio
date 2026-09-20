/**
 * Export-model tests: golden EN/AR parity, absent-scenario fallback,
 * neutral generic copy, stale-snapshot rejection, budgets, and
 * chart-to-metric numeric parity.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkExportModel,
  type AnalysisSnapshot,
  type ExportModel,
  type NormalizedTable,
  type ScenarioResult,
} from '../../../packages/contracts/src/index.ts';
import { analyze } from '../../../packages/analysis/src/index.ts';
import type { AnalysisOptions } from '../../../packages/contracts/interfaces.ts';
import {
  baselineMarginOf,
  buildExportModel,
  ExportModelError,
  isSampleModel,
  localizeDigits,
  numericParity,
  periodLabel,
} from '../../../packages/export-model/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '..', 'tests', 'contract', 'fixtures');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

const table = load<NormalizedTable>('normalized-table.example.json');
const snapshot = load<AnalysisSnapshot>('analysis-snapshot.example.json');
const scenario = load<ScenarioResult>('scenario-result.example.json');
const goldenEn = load<ExportModel>('export-model.en.example.json');
const goldenAr = load<ExportModel>('export-model.ar.example.json');
const CREATED = '2026-09-20T00:00:00Z';

describe('golden parity', () => {
  it('reproduces the EN model up to identity, notes and domain bounds', () => {
    const model = buildExportModel(snapshot, table, scenario, 'en', 'latn', CREATED);
    expect(model.exportId).toBe(goldenEn.exportId);
    expect(model.metrics).toEqual(goldenEn.metrics);
    expect(model.findings).toEqual(goldenEn.findings);
    expect(model.provenance).toEqual(goldenEn.provenance);
    expect(model.qualitySummary).toEqual(goldenEn.qualitySummary);
    expect(model.table).toEqual(goldenEn.table);
    expect(model.slides.map((s) => [s.id, s.kind, s.title, s.subtitle, s.metricIds, s.findingIds, s.chartIds]))
      .toEqual(goldenEn.slides.map((s) => [s.id, s.kind, s.title, s.subtitle, s.metricIds, s.findingIds, s.chartIds]));
    expect(model.sheets).toEqual(goldenEn.sheets);
    expect(model.charts.map((c) => c.id)).toEqual(goldenEn.charts.map((c) => c.id));
    for (const chart of model.charts) {
      const expected = goldenEn.charts.find((c) => c.id === chart.id);
      expect(chart.points).toEqual(expected?.points);
      expect(chart.series).toEqual(expected?.series);
    }
  });

  it('keeps EN/AR numeric parity with separate compositions', () => {
    const en = buildExportModel(snapshot, table, scenario, 'en', 'latn', CREATED);
    const ar = buildExportModel(snapshot, table, scenario, 'ar', 'latn', CREATED);
    expect(ar.slides.map((s) => [s.title, s.subtitle])).toEqual(
      goldenAr.slides.map((s) => [s.title, s.subtitle]),
    );
    expect(ar.sheets).toEqual(goldenAr.sheets);
    expect(ar.metrics).toEqual(en.metrics);
    expect(ar.provenance).toEqual(en.provenance);
    expect(ar.slides.map((s) => [s.metricIds, s.findingIds, s.chartIds])).toEqual(
      en.slides.map((s) => [s.metricIds, s.findingIds, s.chartIds]),
    );
    expect(numericParity(en)).toEqual([]);
    expect(numericParity(ar)).toEqual([]);
  });

  it('passes the contract validator in both locales', () => {
    for (const locale of ['en', 'ar'] as const) {
      const model = buildExportModel(snapshot, table, scenario, locale, 'latn', CREATED);
      expect(checkExportModel(model, { snapshot, scenario, table, sourceHash: snapshot.sourceHash })).toEqual([]);
    }
  });
});

describe('fallbacks and validation', () => {
  it('falls back without a scenario: scenario slide in unavailable state', () => {
    const model = buildExportModel(snapshot, table, null, 'en', 'latn', CREATED);
    expect(model.scenario).toBeNull();
    expect(model.exportId).toBe(`export-${snapshot.id}-en-baseline`);
    expect(model.charts.some((c) => c.id === 'chart-scenario')).toBe(false);
    // Slide four keeps its scenario identity; the unavailable state is a
    // designed limitations rendering, not a different slide kind.
    const slide4 = model.slides[3];
    expect(slide4?.kind).toBe('scenario');
    expect(slide4?.chartIds).toEqual([]);
    expect(checkExportModel(model, { snapshot, table, sourceHash: snapshot.sourceHash })).toEqual([]);
  });

  it('uses neutral copy for unsupported uploads instead of inventing advice', () => {
    const options: AnalysisOptions = {
      version: '1.0.0',
      confirmedScope: { ...snapshot.scope },
      samplePolicyId: null,
    };
    const genericSnapshot = analyze(table, options);
    const model = buildExportModel(genericSnapshot, table, null, 'en', 'latn', CREATED);
    expect(isSampleModel(genericSnapshot, null)).toBe(false);
    expect(model.slides[0]?.title).toBe('Data briefing');
    expect(model.slides[2]?.findingIds).toEqual(['finding-quality']);
    expect(numericParity(model)).toEqual([]);
    expect(checkExportModel(model, { snapshot: genericSnapshot, table, sourceHash: table.sourceRef.sourceHash })).toEqual([]);
  });

  it('rejects stale snapshots and mismatched scenarios', () => {
    const stale = { ...table, normalizationRevision: '0'.repeat(64) };
    expect(() => buildExportModel(snapshot, stale, scenario, 'en', 'latn', CREATED))
      .toThrow(ExportModelError);
    const other = { ...scenario, baselineAnalysisId: 'analysis-other' };
    expect(() => buildExportModel(snapshot, table, other, 'en', 'latn', CREATED))
      .toThrow(ExportModelError);
    expect(() => buildExportModel(snapshot, table, scenario, 'en', 'latn', 'not-a-date'))
      .toThrow(ExportModelError);
  });

  it('holds every slide inside the text budgets', () => {
    for (const locale of ['en', 'ar'] as const) {
      for (const sc of [scenario, null]) {
        const model = buildExportModel(snapshot, table, sc, locale, 'latn', CREATED);
        for (const slide of model.slides) {
          expect(slide.title.length).toBeLessThanOrEqual(60);
          expect(slide.subtitle.length).toBeLessThanOrEqual(80);
          for (const note of slide.notes) expect(note.length).toBeLessThanOrEqual(200);
        }
      }
    }
  });
});

describe('helpers', () => {
  it('extracts the baseline margin leg of the delta proof', () => {
    expect(baselineMarginOf(scenario)).toBe('june-margin');
  });

  it('labels periods per locale and numbering system', () => {
    expect(periodLabel('2026-06-01', '2026-06-30', 'en', 'latn')).toBe('June 2026');
    expect(periodLabel('2026-06-01', '2026-06-30', 'ar', 'latn')).toBe('يونيو 2026');
    expect(periodLabel('2026-06-01', '2026-06-30', 'ar', 'arab')).toBe('يونيو ٢٠٢٦');
    expect(periodLabel(null, null, 'en', 'latn')).toBe('All periods');
    expect(localizeDigits('2026', 'arab')).toBe('٢٠٢٦');
    expect(localizeDigits('2026', 'latn')).toBe('2026');
  });

  it('carries method notes with source identity on the methodology slide', () => {
    const model = buildExportModel(snapshot, table, scenario, 'en', 'latn', CREATED);
    const notes = model.slides[5]?.notes.join('\n') ?? '';
    expect(notes).toContain('sample_operations.xlsx#Operations');
    expect(notes).toContain('no forecast; no causal claim');
  });
});
