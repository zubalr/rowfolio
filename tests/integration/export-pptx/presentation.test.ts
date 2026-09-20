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
import { buildExportModel } from '../../../packages/export-model/src/index.ts';
import {
  buildPresentation,
  ExportPptxError,
} from '../../../packages/export-pptx/src/index.ts';

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
});
