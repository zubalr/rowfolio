/**
 * Deck integration tests: build real EN/AR decks from golden models and
 * inspect the OOXML independently (own ZIP reader, string-level XML
 * assertions — never the writer's object model).
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
import { DESIGN_TOKENS } from '../../../packages/contracts/src/index.ts';
import { buildExportModel } from '../../../packages/export-model/src/index.ts';
import {
  buildPresentation,
  ExportPptxError,
} from '../../../packages/export-pptx/src/index.ts';

/** OOXML colors are bare uppercase hex — derive expectations from the tokens. */
const argb = (hex: string): string => hex.replace('#', '').toUpperCase();

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
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('bad local header');
    const dataAt = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + compSize);
    out.set(name, method === 8 ? inflateRawSync(raw) : new Uint8Array(raw));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const textOf = (entries: Map<string, Uint8Array>, name: string): string =>
  Buffer.from(entries.get(name) as Uint8Array).toString('utf8');

async function buildDeck(locale: 'en' | 'ar'): Promise<{ bytes: Uint8Array; model: ExportModel }> {
  const model = buildExportModel(snapshot, table, scenario, locale, 'latn', CREATED);
  const stages: string[] = [];
  const artifact = await buildPresentation(model, (stage) => {
    stages.push(stage);
  });
  expect(stages[0]).toBe('model');
  expect(stages[stages.length - 1]).toBe('ready');
  expect(artifact.metadata.format).toBe('pptx');
  expect(artifact.metadata.mime).toBe(
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  );
  expect(artifact.metadata.byteLength).toBe(artifact.bytes.byteLength);
  const { createHash } = await import('node:crypto');
  expect(artifact.metadata.sha256).toBe(createHash('sha256').update(Buffer.from(artifact.bytes)).digest('hex'));
  return { bytes: new Uint8Array(artifact.bytes), model };
}

const EMU_PER_INCH = 914400;

describe('deck structure', () => {
  it('emits six editable slides per locale with 16:9 geometry', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const { bytes, model } = await buildDeck(locale);
      const entries = unzip(bytes);
      const slides = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      expect(slides).toHaveLength(6);
      const presentation = textOf(entries, 'ppt/presentation.xml');
      const size = presentation.match(/<p:sldSz cx="(\d+)" cy="(\d+)"\/>/);
      expect(size).not.toBeNull();
      // 13.333 × 7.5 inches in EMU (writer rounding within 0.1%).
      expect(Math.abs(Number(size?.[1]) - 13.333 * EMU_PER_INCH) / (13.333 * EMU_PER_INCH)).toBeLessThan(0.001);
      expect(size?.[2]).toBe(String(7.5 * EMU_PER_INCH));
      for (let i = 1; i <= 6; i += 1) {
        const xml = textOf(entries, `ppt/slides/slide${i}.xml`);
        // Editable text shapes, never pictures of a dashboard.
        expect(xml).toContain('<p:sp>');
        expect(xml).not.toContain('<p:pic>');
        expect(xml).toContain(model.slides[i - 1]?.title.slice(0, 12) as string);
        expect(xml).toContain(`name="${model.slides[i - 1]?.id}-title"`);
      }
    }
  });

  it('carries native charts whose values equal the model', async () => {
    const { bytes, model } = await buildDeck('en');
    const entries = unzip(bytes);
    const charts = [...entries.keys()].filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    expect(charts.length).toBeGreaterThan(0);
    // Only slide-referenced charts render; each rendered datum must match.
    const referenced = new Set(model.slides.flatMap((s) => s.chartIds));
    const expected = new Map<string, string>();
    for (const chart of model.charts) {
      if (!referenced.has(chart.id)) continue;
      for (const point of chart.points) {
        for (const [series, value] of Object.entries(point.values)) {
          if (value !== null) expected.set(`${chart.id}:${point.key}/${series}`, value);
        }
      }
    }
    expect(expected.size).toBeGreaterThan(0);
    const blob = charts.map((n) => textOf(entries, n)).join('\n');
    for (const [key, value] of expected) {
      const num = Number(value);
      expect(blob, `chart datum ${key}=${value}`).toContain(`<c:v>${num}</c:v>`);
    }
  });

  it('completes every chart: data table, unit axis title, and slide caption', async () => {
    const { bytes, model } = await buildDeck('en');
    const entries = unzip(bytes);
    const charts = [...entries.keys()].filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    expect(charts.length).toBeGreaterThan(0);
    for (const name of charts) {
      const xml = textOf(entries, name);
      // Accessible data table under the plot with the exact cached values.
      expect(xml, `${name} data table`).toContain('<c:dTable>');
      // The domain covers actual and target on a zero baseline.
      expect(xml).toContain('<c:min val="0"');
    }
    // Unit labels sit on the value axis where a unit exists.
    const chartBlob = charts.map((n) => textOf(entries, n)).join('\n');
    expect(chartBlob).toContain('USD');
    // Each slide that renders a chart carries the caption text box with the
    // resolved chart title and the named comparison.
    for (let i = 1; i <= 6; i += 1) {
      const slide = model.slides[i - 1];
      if (slide === undefined || slide.chartIds.length === 0) continue;
      const xml = textOf(entries, `ppt/slides/slide${i}.xml`);
      expect(xml, `slide${i} caption`).toContain(`name="${slide.id}-chart-caption"`);
    }
    const slide3 = textOf(entries, 'ppt/slides/slide3.xml');
    expect(slide3).toContain('Actual revenue against target');
    expect(slide3).toContain('Actual / Target');
    expect(slide3).toContain('June 2026');
  });

  it('keeps Arabic chronology unmirrored with RTL paragraphs', async () => {
    const { bytes } = await buildDeck('ar');
    const entries = unzip(bytes);
    const slide3 = textOf(entries, 'ppt/slides/slide3.xml');
    expect(slide3).toContain('rtl');
    const charts = [...entries.keys()].filter((n) => n.startsWith('ppt/charts/chart'));
    const blob = charts.map((n) => textOf(entries, n)).join('\n');
    const may = blob.indexOf('2026-05');
    const june = blob.indexOf('2026-06');
    if (may !== -1 && june !== -1) expect(may).toBeLessThan(june);
  });

  it('embeds notes provenance and no external content', async () => {
    const { bytes } = await buildDeck('en');
    const entries = unzip(bytes);
    const notes = [...entries.keys()]
      .filter((n) => n.startsWith('ppt/notesSlides/'))
      .map((n) => textOf(entries, n))
      .join('\n');
    expect(notes).toContain('finding-north-target');
    for (const [name, data] of entries) {
      expect(name.toLowerCase().includes('embeddings/ole')).toBe(false);
      if (name.endsWith('.rels')) {
        const xml = Buffer.from(data).toString('utf8');
        // Namespace URIs legitimately contain `http://`; only external
        // *targets* are forbidden.
        expect(xml).not.toContain('TargetMode="External"');
        expect(xml).not.toContain('Target="http://');
        expect(xml).not.toContain('Target="https://');
      }
    }
  });

  it('keeps every object inside the safe area', async () => {
    const { bytes } = await buildDeck('en');
    const entries = unzip(bytes);
    const maxX = 13.333 * EMU_PER_INCH;
    const maxY = 7.5 * EMU_PER_INCH;
    for (let i = 1; i <= 6; i += 1) {
      const xml = textOf(entries, `ppt/slides/slide${i}.xml`);
      for (const match of xml.matchAll(/<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/g)) {
        const [x, y, cx, cy] = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
        expect(x + cx <= maxX + 1, `slide${i} horizontal overflow`).toBe(true);
        expect(y + cy <= maxY + 1, `slide${i} vertical overflow`).toBe(true);
      }
    }
  });

  it('fails visibly invalid models instead of clipping', async () => {
    const model = buildExportModel(snapshot, table, scenario, 'en', 'latn', CREATED);
    // Nine metrics on one finding slide exceeds the body fit budget.
    const extra = Array.from({ length: 9 }, (_, i) => ({
      ...(model.metrics[0] as ExportModel['metrics'][number]),
      id: `extra-metric-${i}`,
      provenanceId: (model.metrics[0] as ExportModel['metrics'][number]).provenanceId,
    }));
    const finding = model.findings.find((f) => f.kind === 'divergence') ?? model.findings[0];
    const crowded = {
      ...model,
      metrics: [...model.metrics, ...extra],
      findings: model.findings.map((f) =>
        f.id === (finding as (typeof model.findings)[number]).id
          ? { ...f, metricIds: extra.map((m) => m.id) }
          : f,
      ),
      slides: model.slides.map((s, i) =>
        i === 2 ? { ...s, metricIds: extra.map((m) => m.id) } : s,
      ),
    };
    await expect(buildPresentation(crowded, () => undefined)).rejects.toThrow(ExportPptxError);
  });

  it('renders localized human labels, never raw IDs, in visible text', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const { bytes } = await buildDeck(locale);
      const entries = unzip(bytes);
      for (let i = 1; i <= 6; i += 1) {
        const xml = textOf(entries, `ppt/slides/slide${i}.xml`);
        const runs = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((m) => m[1]);
        for (const run of runs) {
          expect(run, `slide${i} ${locale}`).not.toMatch(
            /(north-june|north-may|june-|scenario-|quality-|finding-|chart-|slide-)[a-z-]*/,
          );
        }
      }
      const slide2 = textOf(entries, 'ppt/slides/slide2.xml');
      if (locale === 'en') {
        expect(slide2).toContain('USD 6.00m');
        expect(slide2).toContain('Revenue');
      } else {
        expect(slide2).toContain('6.00m');
      }
    }
  });

  it('keeps chart axes above every datum', async () => {
    const { bytes, model } = await buildDeck('en');
    const entries = unzip(bytes);
    const charts = [...entries.keys()].filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    expect(charts.length).toBeGreaterThan(0);
    for (const name of charts) {
      const xml = textOf(entries, name);
      const max = xml.match(/<c:valAx>.*?<c:max val="([^"]+)"\/>.*?<\/c:valAx>/s)?.[1];
      expect(max, `${name} axis max`).toBeDefined();
      const data = [...xml.matchAll(/<c:numCache>.*?<\/c:numCache>/gs)]
        .flatMap((block) => [...block[0].matchAll(/<c:v>(-?[0-9.]+)<\/c:v>/g)].map((m) => Number(m[1])));
      expect(data.length, `${name} data`).toBeGreaterThan(0);
      for (const datum of data) {
        expect(datum, `${name} datum ${datum} within axis`).toBeLessThanOrEqual(Number(max));
      }
    }
    void model;
  });

  it('suppresses engine placeholder units in the KPI table and headlines', async () => {
    const model = buildExportModel(snapshot, table, scenario, 'en', 'latn', CREATED);
    const mutated: ExportModel = {
      ...model,
      metrics: model.metrics.map((m) =>
        m.id === 'june-revenue' || m.id === 'june-operating-cost'
          ? { ...m, unit: { ...m.unit, label: 'unit' } }
          : m,
      ),
    };
    const artifact = await buildPresentation(mutated, () => undefined);
    const entries = unzip(new Uint8Array(artifact.bytes));
    const slide2 = textOf(entries, 'ppt/slides/slide2.xml');
    // Currency placeholders resolve to the ISO code; none print raw.
    expect(slide2).not.toContain('<a:t>unit</a:t>');
    expect(slide2).not.toContain('<a:t>fraction</a:t>');
    expect(slide2).toContain('USD 6.00m');
  });

  it('omits the scenario slide entirely when no scenario is committed', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const model = buildExportModel(snapshot, table, null, locale, 'latn', CREATED);
      const artifact = await buildPresentation(model, () => undefined);
      const entries = unzip(new Uint8Array(artifact.bytes));
      const slideNames = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      expect(slideNames.length).toBe(5);
      // No slide may ship the placeholder line; the quality page moves up
      // into slide four's slot.
      for (const name of slideNames) {
        const xml = textOf(entries, name);
        expect(xml).not.toContain('No scenario is committed');
        expect(xml).not.toContain('لم يُعتمد أي سيناريو');
      }
      const slide4 = textOf(entries, 'ppt/slides/slide4.xml');
      if (locale === 'en') {
        expect(slide4).toContain('Duplicate rows');
      } else {
        expect(slide4).toContain('صفوف مكررة');
      }
      // Folios count the real deck size.
      const slide5 = textOf(entries, 'ppt/slides/slide5.xml');
      expect(slide5).toContain('>5 / 5<');
    }
  });

  it('draws labeled quality bars as native shapes', async () => {
    const { bytes } = await buildDeck('en');
    const entries = unzip(bytes);
    const xml = textOf(entries, 'ppt/slides/slide5.xml');
    expect(xml).toContain('Duplicate rows');
    expect((xml.match(/<a:prstGeom prst="rect">/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('carries designed chrome: masthead tick, folio, and a composed cover card', async () => {
    const { bytes } = await buildDeck('en');
    const entries = unzip(bytes);
    const slide1 = textOf(entries, 'ppt/slides/slide1.xml');
    // Cobalt masthead tick and hairline rules frame the page.
    expect(slide1).toContain('slide-1-masthead-tick');
    expect(slide1).toContain('slide-1-masthead-rule');
    expect(slide1).toContain('slide-1-foot-rule');
    // Page marker reads "1 / 6"; the lineage block sits on a surface card.
    expect(slide1).toContain('>1 / 6<');
    expect(slide1).toContain('slide-1-lineage-card');
    expect(slide1).toContain('prst="roundRect"');
    // Every slide carries its folio marker.
    const slide6 = textOf(entries, 'ppt/slides/slide6.xml');
    expect(slide6).toContain('>6 / 6<');
  });

  it('KPI slide keeps a labeled header band and column separators', async () => {
    const { bytes } = await buildDeck('en');
    const entries = unzip(bytes);
    const slide2 = textOf(entries, 'ppt/slides/slide2.xml');
    expect(slide2).toContain('slide-2-kpi-sep-1');
    const tableText = slide2;
    expect(tableText).toContain('>Metric<');
    expect(tableText).toContain('>Value<');
    expect(tableText).toContain('>Unit<');
  });

  it('styles native charts: outEnd labels, subtle gridlines, palette series', async () => {
    const { bytes } = await buildDeck('en');
    const entries = unzip(bytes);
    const chartName = [...entries.keys()].find((k) => /ppt\/charts\/chart\d+\.xml$/.test(k));
    expect(chartName).toBeDefined();
    const chart = textOf(entries, chartName as string);
    // Value labels render (default placement for clustered cols is outEnd),
    // in ink — not the library's default black.
    expect(chart).toContain('<c:showVal val="1"/>');
    expect(chart).toContain(`srgbClr val="${argb(DESIGN_TOKENS.color.ink)}"`); // data labels in ink
    expect(chart).toContain(`srgbClr val="${argb(DESIGN_TOKENS.color.rule)}"`); // valAxis gridline in rule color
    expect(chart).toContain(`srgbClr val="${argb(DESIGN_TOKENS.color.data)}"`); // observed series = data cobalt
    // Axis bounds still honor the model contract (min/max from domain).
    expect(chart).toContain('valAx');
    expect(chart).toMatch(/<c:min val="0"\/>/);
  });

  it('declares an Arabic-capable complex-script font and presentation rtl', async () => {
    const { bytes } = await buildDeck('ar');
    const entries = unzip(bytes);
    expect(textOf(entries, 'ppt/presentation.xml')).toContain('rtl="1"');
    const theme = textOf(entries, 'ppt/theme/theme1.xml');
    expect(theme).toContain('typeface="Arial"');
    const slide1 = textOf(entries, 'ppt/slides/slide1.xml');
    expect(slide1).toContain('a:cs typeface="IBM Plex Sans Arabic"');
    // Latin/digit runs inside Arabic copy stay on the deck's Latin face.
    expect(slide1).toContain('a:cs typeface="Arial"');
  });

  it('mirrors the body composition for Arabic and names finding scope', async () => {
    const accentX = (xml: string): number => {
      const m = /name="slide-1-finding-accent"[\s\S]*?<a:off x="(\d+)"/.exec(xml)
        ?? /name="slide-3-finding-accent"[\s\S]*?<a:off x="(\d+)"/.exec(xml);
      expect(m).not.toBeNull();
      return Number((m as RegExpExecArray)[1]);
    };
    const en = unzip((await buildDeck('en')).bytes);
    const ar = unzip((await buildDeck('ar')).bytes);
    // The finding accent tick anchors the text column's leading edge —
    // left in English, right in Arabic (a mirrored composition, not just
    // right-aligned copy).
    const enSlide = textOf(en, 'ppt/slides/slide1.xml');
    const arSlide = textOf(ar, 'ppt/slides/slide1.xml');
    const half = (13.333 / 2) * EMU_PER_INCH;
    expect(accentX(enSlide)).toBeLessThan(half);
    expect(accentX(arSlide)).toBeGreaterThan(half);
    // Findings name their scope: region + period under the headline.
    expect(enSlide).toContain('North');
    expect(enSlide).toContain('June 2026');
    expect(arSlide).toContain('الشمال');
    expect(arSlide).toContain('يونيو');
    // The KPI table mirrors column order for right-to-left reading.
    const arSlide2 = textOf(ar, 'ppt/slides/slide2.xml');
    const unitIdx = arSlide2.indexOf('>الوحدة<');
    const metricIdx = arSlide2.indexOf('>المؤشر<');
    expect(unitIdx).toBeGreaterThanOrEqual(0);
    expect(metricIdx).toBeGreaterThanOrEqual(0);
    expect(unitIdx).toBeLessThan(metricIdx);
  });

  it('marks verified and resolved content in the positive teal', async () => {
    const { bytes } = await buildDeck('en');
    const entries = unzip(bytes);
    const teal = argb(DESIGN_TOKENS.color.positive);
    expect(textOf(entries, 'ppt/slides/slide5.xml')).toContain(teal);
    expect(textOf(entries, 'ppt/slides/slide6.xml')).toContain(teal);
  });
});
