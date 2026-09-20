/**
 * Native presentation writer: a PptxGenJS adapter over a validated
 * ExportModel. Six editable slides from the model's slide descriptors —
 * never dashboard screenshots, never generated prose. Charts are native
 * objects fed with the model's chart values; Arabic decks are separate
 * compositions (right-aligned, RTL paragraphs, unmirrored chronology).
 *
 * Portable Arial references only; no embedded fonts, no remote images,
 * no external relationships. Content that cannot fit its box fails with
 * a typed error instead of clipping.
 */
import PptxGenJS from 'pptxgenjs';
import { assertExportModel, isDecimal, sha256Hex } from '@rowfolio/contracts';
import type { ExportModel } from '@rowfolio/contracts';
import type {
  BuiltArtifact,
  BuildPresentation,
  Progress,
} from '@rowfolio/contracts/interfaces';

export class ExportPptxError extends Error {
  readonly code: 'layout-overflow' | 'invalid-model' | 'unsupported-chart';
  constructor(code: ExportPptxError['code'], message: string) {
    super(message);
    this.name = 'ExportPptxError';
    this.code = code;
  }
}

const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const INK = '1A1A1A';
const COBALT = '1D4ED8';
const AMBER = 'D97706';
const RED = 'B91C1C';
const PAPER = 'F8F5EC';
const FONT = 'Arial';

const TITLE_SIZE = 32;
const BODY_SIZE = 20;
const FOOT_SIZE = 11;
const MAX_BODY_BULLETS = 8;

interface ChartDatum {
  readonly series: string;
  readonly labels: string[];
  readonly values: number[];
}

function toChartNumber(value: string, where: string): number {
  if (!isDecimal(value)) {
    throw new ExportPptxError('invalid-model', `chart value is not a decimal (${where})`);
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new ExportPptxError('invalid-model', `chart value is not finite (${where})`);
  }
  return num;
}

/** Split mixed-direction text into native runs (IDs/numerals stay LTR). */
function runsFor(text: string, locale: 'en' | 'ar'): Array<{ text: string; options: { rtlMode: boolean } }> {
  if (locale === 'en') return [{ text, options: { rtlMode: false } }];
  const parts = text.split(/([0-9][0-9.,%]*|[A-Za-z_][A-Za-z0-9_.:-]*)/g).filter((p) => p !== '');
  return parts.map((part) => ({
    text: part,
    options: { rtlMode: /^[0-9A-Za-z_]/.test(part) ? false : true },
  }));
}

function formatMetricValue(value: string | null, unitLabel: string): string {
  if (value === null) return 'n/a';
  return unitLabel === 'fraction' || unitLabel === 'pp' ? value : `${value} ${unitLabel}`.trim();
}

function bulletColor(kind: string): string {
  switch (kind) {
    case 'quality':
      return AMBER;
    case 'methodology':
      return INK;
    default:
      return COBALT;
  }
}

export const buildPresentation: BuildPresentation = async (
  model: ExportModel,
  progress: Progress,
): Promise<BuiltArtifact> => {
  progress('model', 0.05);
  assertExportModel(model);
  if (model.slides.length !== 6) {
    throw new ExportPptxError('invalid-model', `expected six slide descriptors, got ${model.slides.length}`);
  }

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.author = 'Rowfolio';
  pptx.title = model.slides[0]?.title ?? 'Rowfolio briefing';

  const rtl = model.locale === 'ar';
  const align = rtl ? 'right' : 'left';
  const chartById = new Map(model.charts.map((c) => [c.id, c] as const));
  const metricById = new Map(model.metrics.map((m) => [m.id, m] as const));
  for (const scenarioMetric of model.scenario?.metrics ?? []) {
    if (!metricById.has(scenarioMetric.id)) metricById.set(scenarioMetric.id, scenarioMetric);
  }

  progress('layout', 0.2);

  model.slides.forEach((slide, index) => {
    const deck = pptx.addSlide();
    deck.background = { color: PAPER };
    deck.addText(runsFor(slide.title, model.locale) as never, {
      x: 0.55,
      y: 0.35,
      w: 12.23,
      h: 1.1,
      fontSize: TITLE_SIZE,
      fontFace: FONT,
      bold: true,
      color: INK,
      align,
      rtlMode: rtl,
      objectName: `${slide.id}-title`,
    });
    deck.addText(runsFor(slide.subtitle, model.locale) as never, {
      x: 0.55,
      y: 1.35,
      w: 12.23,
      h: 0.5,
      fontSize: 16,
      fontFace: FONT,
      color: '555555',
      align,
      rtlMode: rtl,
      objectName: `${slide.id}-subtitle`,
    });

    const bullets: string[] = [];
    if (slide.kind === 'kpis' || slide.kind === 'finding' || slide.kind === 'scenario') {
      for (const id of slide.metricIds) {
        const metric = metricById.get(id);
        if (metric === undefined) continue;
        bullets.push(`${id}: ${formatMetricValue(metric.value, metric.unit.label)}`);
      }
    } else if (slide.kind === 'quality') {
      bullets.push(
        `issues: ${model.qualitySummary.issueCount}`,
        `resolved: ${model.qualitySummary.resolved}`,
        `unresolved: ${model.qualitySummary.unresolved}`,
      );
    } else if (slide.kind === 'methodology') {
      bullets.push(
        `source: ${model.table.sourceRef.workbookName}#${model.table.sourceRef.sheetName}`,
        `records: ${model.qualitySummary.retainedRows}/${model.qualitySummary.rawRows}`,
        `hash: ${model.sourceHash.slice(0, 12)}`,
      );
    } else {
      const lead = slide.findingIds[0];
      bullets.push(
        `scope: ${model.scope.periodStart ?? 'all'}..${model.scope.periodEnd ?? 'all'}`,
        lead !== undefined ? `lead: ${lead}` : 'briefing ready',
      );
    }
    if (bullets.length > MAX_BODY_BULLETS) {
      throw new ExportPptxError(
        'layout-overflow',
        `slide ${slide.id} has ${bullets.length} bullets over the ${MAX_BODY_BULLETS} fit budget`,
      );
    }
    deck.addText(
      bullets.map((line) => ({ text: line, options: { bullet: { code: '25AA' }, breakLine: true } })),
      {
        x: 0.55,
        y: 2.1,
        w: 5.6,
        h: 3.6,
        fontSize: BODY_SIZE,
        fontFace: FONT,
        color: bulletColor(slide.kind),
        align,
        rtlMode: rtl,
        objectName: `${slide.id}-body`,
      },
    );

    const chartIds = slide.chartIds.filter((id) => chartById.has(id));
    if (chartIds.length > 0) {
      const chart = chartById.get(chartIds[0] as string);
      if (chart === undefined) {
        throw new ExportPptxError('invalid-model', `unknown chart ${chartIds[0]}`);
      }
      if (chart.points.length === 0 || chart.points.length > 12) {
        throw new ExportPptxError('layout-overflow', `chart ${chart.id} has ${chart.points.length} points`);
      }
      const seriesNames = [...new Set(chart.points.flatMap((p) => Object.keys(p.values)))];
      const data: ChartDatum[] = seriesNames.map((series) => ({
        series,
        labels: chart.points.map((p) => p.key),
        values: chart.points.map((p) => toChartNumber(p.values[series] ?? '0', `${chart.id}/${p.key}`)),
      }));
      deck.addChart(pptx.ChartType.bar, data as never, {
        x: 6.5,
        y: 2.1,
        w: 6.28,
        h: 3.6,
        barDir: 'col',
        showLegend: seriesNames.length > 1,
        showTitle: false,
        showValue: true,
        dataLabelFontSize: 11,
        chartColors: seriesNames.map((_, i) => (i === 0 ? COBALT : AMBER) as never),
        valAxisMinVal: Number(chart.domain.min),
        valAxisMaxVal: Number(chart.domain.max),
        catAxisLabelFontSize: 11,
        valAxisLabelFontSize: 11,
      });
    } else {
      const detail = slide.findingIds.length > 0
        ? slide.findingIds.join(', ')
        : slide.metricIds.slice(0, 4).join(', ');
      deck.addText(runsFor(detail, model.locale) as never, {
        x: 6.5,
        y: 2.1,
        w: 6.28,
        h: 3.6,
        fontSize: 16,
        fontFace: FONT,
        color: '444444',
        align,
        rtlMode: rtl,
        objectName: `${slide.id}-detail`,
      });
    }

    deck.addText(runsFor(slide.notes.join(' · '), model.locale) as never, {
      x: 0.55,
      y: 6.85,
      w: 12.23,
      h: 0.5,
      fontSize: FOOT_SIZE,
      fontFace: FONT,
      color: '666666',
      align,
      rtlMode: rtl,
      objectName: `${slide.id}-notes`,
    });
    if (slide.notes.length > 0) deck.addNotes(slide.notes.join('\n'));
    progress('charts', 0.2 + (0.6 * (index + 1)) / 6);
  });

  progress('package', null);
  const bytes = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  const sha256 = await sha256Hex(new Uint8Array(bytes));
  progress('ready', 1);
  return {
    metadata: {
      exportId: model.exportId,
      format: 'pptx',
      mime: MIME,
      filename: `rowfolio-${model.exportId}.pptx`,
      byteLength: bytes.byteLength,
      sha256,
      binarySlot: 'deck',
    },
    bytes,
  };
};

export { RED };
