/**
 * Preview parity: SlidePreview must derive every string and figure from the
 * ExportModel through the shared deck copy/format surface — never hardcoded
 * copy. Feeding the contract fixtures in both locales and asserting model
 * values render is the contract test the preview is held to.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { ExportModel } from '@rowfolio/contracts';
import { exportFileName } from '@rowfolio/export-model';
import { label, scopeText } from '@rowfolio/export-pptx';
import { SlidePreview, WorkbookPreview } from './SlidePreview.tsx';
import enFixture from '../../../../tests/contract/fixtures/export-model.en.example.json';
import arFixture from '../../../../tests/contract/fixtures/export-model.ar.example.json';

const EN = enFixture as unknown as ExportModel;
const AR = arFixture as unknown as ExportModel;

function renderSlide(model: ExportModel, kind: string): string {
  const slide = model.slides.find((s) => s.kind === kind);
  if (slide === undefined) throw new Error(`fixture lacks a ${kind} slide`);
  return renderToStaticMarkup(createElement(SlidePreview, { model, slide }));
}

describe('SlidePreview parity with ExportModel', () => {
  it('renders the real slide title, finding headline and scope line', () => {
    const slide = EN.slides[0]!;
    const html = renderSlide(EN, 'summary');
    expect(html).toContain(slide.title);
    expect(html).toContain(label('en', 'finding.north.title'));
    const finding = EN.findings.find((f) => f.id === 'finding-north-target')!;
    expect(html).toContain(scopeText('en', finding.scope, 'latn'));
  });

  it('renders real figure values on the KPI slide', () => {
    const html = renderSlide(EN, 'kpis');
    // Fixture KPI slide: revenue 6,000,000.00 compacted to the headline
    // the deck prints (USD 6.00m), plus the exact table value.
    expect(html).toContain('6.00m');
    expect(html).toContain('6,000,000.00');
    expect(html).toContain('25.0%');
  });

  it('renders chart marks scaled from the model points', () => {
    const html = renderSlide(EN, 'finding');
    const chart = EN.charts.find((c) => c.id === 'chart-north-target')!;
    // 881000 / 1100000 on the 88% track = 70.48% height on the observed
    // bar; the value readout rides above the mark ('USD 881k').
    expect(html).toContain('height:70.48%');
    // The target mark must carry its own scale (1000000 / 1100000 → 80%)
    // — a shared height would render the comparison meaningless.
    expect(html).toContain('height:80%');
    expect(html).toContain('USD 881k');
    expect(html).toContain('Actual / Target');
    expect(chart.points[0]!.values.actual).toBe('881000');
  });

  it('renders the committed scenario values, and a designed empty state when none', () => {
    const html = renderSlide(EN, 'scenario');
    expect(html).toContain(label('en', 'scenario.question'));
    expect(html).toContain('1,140,000.00');
    const empty = renderToStaticMarkup(
      createElement(SlidePreview, {
        model: { ...EN, scenario: null },
        slide: EN.slides.find((s) => s.kind === 'scenario')!,
      }),
    );
    expect(empty).toContain(label('en', 'scenario.notCommitted'));
  });

  it('renders reconciliation numbers from qualitySummary', () => {
    const html = renderSlide(EN, 'quality');
    expect(html).toContain('>24<');
    expect(html).toContain('>5<');
    expect(html).toContain('>29<');
  });

  it('renders the source block on the methodology slide', () => {
    const html = renderSlide(EN, 'methodology');
    expect(html).toContain('sample_operations.xlsx');
    expect(html).toContain(EN.sourceHash.slice(0, 12));
  });

  it('composes the Arabic model under dir=rtl with localized copy', () => {
    const html = renderSlide(AR, 'summary');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain(AR.slides[0]!.title);
    expect(html).toContain(label('ar', 'finding.north.title'));
    const finding = AR.findings.find((f) => f.id === 'finding-north-target')!;
    expect(html).toContain(scopeText('ar', finding.scope, AR.numberingSystem));
    // Arabic copy resolves: localized region name, localized month.
    expect(html).toContain('الشمال');
  });

  it('lists the real sheet names on the workbook preview', () => {
    const html = renderToStaticMarkup(createElement(WorkbookPreview, { model: EN }));
    for (const sheet of EN.sheets) {
      expect(html).toContain(`>${sheet.name}<`);
    }
    expect(html).toContain(exportFileName(EN, 'xlsx'));
  });

  it('renders an Arabic workbook list with Arabic sheet names', () => {
    const html = renderToStaticMarkup(createElement(WorkbookPreview, { model: AR }));
    expect(html).toContain('dir="rtl"');
    for (const sheet of AR.sheets) {
      expect(html).toContain(`>${sheet.name}<`);
    }
  });
});
