/**
 * Six authored slide compositions for the native deck.
 *
 * Every layout renders exact ExportModel data — localized human labels
 * with formatted model values, native charts fed with model chart values,
 * provenance carried in notes and object names. Nothing is hardcoded to
 * the sample: sample semantics emerge from the model's own findings,
 * metrics and charts; generic uploads get the same compositions with
 * truthful neutral content and designed empty states.
 *
 * Text budgets are enforced by character count per box; overflow fails
 * typed instead of clipping.
 */
import type PptxGenJS from 'pptxgenjs';

type TextRun = PptxGenJS.TextProps;
import { DESIGN_TOKENS, isDecimal } from '@rowfolio/contracts';
import type {
  ChartSpec,
  ExportModel,
  Finding,
  Locale,
  Metric,
  SlideModel,
} from '@rowfolio/contracts';
import { exportUnitLabel } from '@rowfolio/export-model';
import { ExportPptxError } from './presentation.ts';
import { hasLabel, label } from './labels.ts';
import {
  formatCompact,
  formatInteger,
  formatMetricValue,
  formatPercent,
} from './format.ts';

type Deck = ReturnType<InstanceType<typeof PptxGenJS>['addSlide']>;

const token = (hex: string): string => hex.replace('#', '').toUpperCase();
const INK = token(DESIGN_TOKENS.color.ink);
const COBALT = token(DESIGN_TOKENS.color.data);
const AMBER = token(DESIGN_TOKENS.color.scenario);
/** Restrained adverse red, re-exported for compatibility. */
export const RED = token(DESIGN_TOKENS.color.negative);
const SLATE = token(DESIGN_TOKENS.color.muted);
const GRAY = token(DESIGN_TOKENS.color.muted);
const PAPER = token(DESIGN_TOKENS.color.paper);
const SURFACE = token(DESIGN_TOKENS.color.surface);
const RULE = token(DESIGN_TOKENS.color.rule);
const FONT = DESIGN_TOKENS.font.deck;
/** Arabic-capable face for complex-script runs (Arabic glyphs + shaping). */
const FONT_AR = DESIGN_TOKENS.font.arabic;

const TITLE_SIZE = 32;
const SUBTITLE_SIZE = 16;
const HEADLINE_SIZE = 26;
const BODY_SIZE = 18;
const SMALL_SIZE = 14;
const FOOT_SIZE = 11;

const LEFT_X = 0.55;
const LEFT_W = 5.6;
const RIGHT_X = 6.5;
const RIGHT_W = 6.28;
const BODY_Y = 2.1;
const BODY_H = 3.6;
const FOOT_Y = 6.85;

export interface LayoutContext {
  readonly deck: Deck;
  readonly model: ExportModel;
  readonly slide: SlideModel;
  readonly locale: Locale;
  readonly rtl: boolean;
  readonly align: 'left' | 'right';
  readonly metricById: ReadonlyMap<string, Metric>;
  readonly chartById: ReadonlyMap<string, ChartSpec>;
  readonly findingById: ReadonlyMap<string, Finding>;
  readonly isSample: boolean;
}

/** A requested region/model filter the sample pack recognizes. */
export function isSampleModel(model: ExportModel): boolean {
  return model.findings.some((f) => f.ruleId === 'north-target-orders-v1')
    && model.metrics.some((m) => m.id === 'north-june-revenue');
}

/**
 * Runs with per-script font faces: Arabic words get the complex-script
 * Arabic face so the declared cs typeface is Arabic-capable; digits and
 * Latin tokens inside Arabic copy stay on the deck's portable Latin face.
 */
function runsFor(text: string, locale: Locale): Array<{ text: string; options: { rtlMode: boolean; fontFace: string } }> {
  if (locale === 'en') return [{ text, options: { rtlMode: false, fontFace: FONT } }];
  const parts = text.split(/([0-9][0-9.,%]*|[A-Za-z_][A-Za-z0-9_.:-]*)/g).filter((p) => p !== '');
  return parts.map((part) => {
    const latin = /^[0-9A-Za-z_]/.test(part);
    return { text: part, options: { rtlMode: !latin, fontFace: latin ? FONT : FONT_AR } };
  });
}

/** Character budget guard: approximate Arial capacity, fail loudly. */
function fitGuard(slideId: string, box: string, text: string, fontPt: number, widthIn: number, heightIn: number): void {
  const perLine = Math.max(8, Math.floor((widthIn * 72) / (fontPt * 0.5)));
  const lines = Math.max(1, Math.ceil(heightIn * 72 / (fontPt * 1.2)));
  if (text.length > perLine * lines) {
    throw new ExportPptxError(
      'layout-overflow',
      `slide ${slideId} box ${box} holds ${text.length} chars over budget ${perLine * lines}`,
    );
  }
}

/** `Name: value` split into two runs — label recessive, value emphasized. */
function metricLineRuns(ctx: LayoutContext, metric: Metric): TextRun[] {
  const name = hasLabel(metric.labelKey) ? label(ctx.locale, metric.labelKey) : metric.id;
  return [
    { text: `${name}  `, options: { color: GRAY } },
    { text: formatMetricValue(metric.value, metric.unit), options: { color: INK, bold: true } },
  ];
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;

/**
 * Display name for a metric within a slide set: when the same label key
 * would name two cells identically (e.g. May vs June order volume), qualify
 * with the metric's period-end month. Only rendered when that period key is
 * in the copy table — otherwise the plain name stands.
 */
function metricDisplayName(ctx: LayoutContext, metric: Metric, siblings: readonly Metric[]): string {
  const name = hasLabel(metric.labelKey) ? label(ctx.locale, metric.labelKey) : metric.id;
  const duplicates = siblings.filter((m) => m.id !== metric.id && m.labelKey === metric.labelKey);
  if (duplicates.length === 0) return name;
  const end = metric.scope.periodEnd;
  const month = end === null ? undefined : MONTHS[Number(end.slice(5, 7)) - 1];
  const key = month !== undefined ? `period.${month}` : '';
  if (key === '' || !hasLabel(key)) return name;
  return `${name} · ${label(ctx.locale, key)}`;
}

function chrome(ctx: LayoutContext): void {
  const { deck, slide, locale, rtl, align } = ctx;
  deck.background = { color: PAPER };
  // Cobalt tick + hairline rule: a reading frame that anchors the masthead
  // and separates title block from evidence.
  bar(ctx, 'masthead-tick', LEFT_X, 0.30, 0.62, 0.075, COBALT);
  deck.addText(runsFor(slide.title, locale), {
    x: LEFT_X, y: 0.42, w: 12.23, h: 0.95,
    fontSize: TITLE_SIZE, fontFace: FONT, bold: true, color: INK,
    align, rtlMode: rtl, objectName: `${slide.id}-title`,
  });
  deck.addText(runsFor(slide.subtitle, locale), {
    x: LEFT_X, y: 1.38, w: 12.23, h: 0.45,
    fontSize: SUBTITLE_SIZE, fontFace: FONT, color: GRAY,
    align, rtlMode: rtl, objectName: `${slide.id}-subtitle`,
  });
  bar(ctx, 'masthead-rule', LEFT_X, 1.92, 12.23, 0.018, RULE);
  const notes = slide.notes.join(' · ');
  // Visible footer carries human evidence pointers only; raw IDs live in
  // speaker notes and object names, never in display text.
  const footer = footerContent(ctx);
  bar(ctx, 'foot-rule', LEFT_X, 6.78, 12.23, 0.018, RULE);
  if (footer !== null) {
    deck.addText(runsFor(footer, locale), {
      x: LEFT_X, y: FOOT_Y, w: 10.4, h: 0.5,
      fontSize: FOOT_SIZE, fontFace: FONT, color: GRAY,
      align, rtlMode: rtl, objectName: `${slide.id}-notes`,
    });
  }
  const index = Number(slide.id.replace('slide-', '')) || 0;
  deck.addText([{ text: `${index} / ${ctx.model.slides.length}`, options: { rtlMode: false, fontFace: FONT } }], {
    x: 11.2, y: FOOT_Y, w: 1.58, h: 0.4,
    fontSize: FOOT_SIZE, fontFace: FONT, color: GRAY, align: 'right',
    objectName: `${slide.id}-folio`,
  });
  if (slide.notes.length > 0) {
    // PptxGenJS 4.0.1 silently drops notes containing a line break, so
    // multi-part provenance joins one paragraph rather than vanishing.
    deck.addNotes(notes);
  }
}

/**
 * Human footer: source-row spans plus the lead caveat for finding slides,
 * otherwise the scope coverage line. Returns null when nothing human can
 * be said — the box is then omitted rather than filled with IDs.
 */
function footerContent(ctx: LayoutContext): string | null {
  const { slide, locale } = ctx;
  const finding = slide.findingIds.map((id) => ctx.findingById.get(id)).find((f) => f !== undefined);
  if (finding !== undefined) {
    const parts: string[] = [];
    const spans = findingSpanTokens(ctx, finding);
    if (spans !== null) parts.push(`${label(locale, 'evidence.sourceRows')}: ${spans}`);
    const limitation = finding.limitations.find((key) => hasLabel(key));
    if (limitation !== undefined) parts.push(label(locale, limitation));
    if (parts.length > 0) return parts.join(' · ');
  }
  return coverageLine(ctx);
}

/** First distinct span tokens of a finding's proofs, bounded with an overflow count. */
function findingSpanTokens(ctx: LayoutContext, finding: Finding): string | null {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const proofId of finding.provenanceIds) {
    const proof = ctx.model.provenance.find((p) => p.id === proofId);
    for (const selection of proof?.selections ?? []) {
      for (const span of selection.spans) {
        const token = `${span.start}–${span.end}`;
        if (seen.has(token)) continue;
        seen.add(token);
        if (tokens.length < 2) tokens.push(token);
      }
    }
  }
  if (tokens.length === 0) return null;
  return seen.size > tokens.length ? `${tokens.join(', ')} +${seen.size - tokens.length}` : tokens.join(', ');
}

function textBox(
  ctx: LayoutContext,
  name: string,
  runs: TextRun[],
  box: { x: number; y: number; w: number; h: number; fontSize: number; color?: string; bold?: boolean; align?: 'left' | 'right' | 'center'; valign?: 'top' | 'middle' | 'bottom' },
): void {
  const plain = runs.map((r) => r.text ?? '').join('');
  fitGuard(ctx.slide.id, name, plain, box.fontSize, box.w, box.h);
  ctx.deck.addText(runs, {
    x: box.x, y: box.y, w: box.w, h: box.h,
    fontSize: box.fontSize, fontFace: FONT,
    color: box.color ?? INK, bold: box.bold ?? false,
    align: box.align ?? ctx.align, rtlMode: ctx.rtl,
    ...(box.valign !== undefined ? { valign: box.valign } : {}),
    objectName: `${ctx.slide.id}-${name}`,
  });
}

function bar(
  ctx: LayoutContext,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  if (w <= 0) return;
  ctx.deck.addShape('rect', {
    x, y, w, h, fill: { color: color }, line: { color: color },
    objectName: `${ctx.slide.id}-${name}`,
  });
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

function semanticColor(semantic: string): string {
  switch (semantic) {
    case 'observed': return COBALT;
    case 'target': return SLATE;
    case 'scenario': return AMBER;
    case 'attention': return RED;
    default: return COBALT;
  }
}

/** Native bar chart from a model ChartSpec. Null data fails visibly — never renders as zero. */
export function chartBox(
  ctx: LayoutContext,
  chartId: string,
  box: { x: number; y: number; w: number; h: number },
): void {
  const chart = ctx.chartById.get(chartId);
  if (chart === undefined) {
    throw new ExportPptxError('invalid-model', `unknown chart ${chartId}`);
  }
  if (chart.points.length === 0 || chart.points.length > 12) {
    throw new ExportPptxError('layout-overflow', `chart ${chart.id} has ${chart.points.length} points`);
  }
  const seriesIds = [...new Set(chart.points.flatMap((p) => Object.keys(p.values)))];
  const data = seriesIds.map((series) => {
    const spec = chart.series.find((s) => s.id === series);
    const name = spec !== undefined && hasLabel(spec.labelKey) ? label(ctx.locale, spec.labelKey) : series;
    return {
      name,
      labels: chart.points.map((p) => (hasLabel(p.labelKey) ? label(ctx.locale, p.labelKey) : p.key)),
      values: chart.points.map((p) => {
        const raw = p.values[series];
        if (raw === null || raw === undefined) {
          throw new ExportPptxError('unsupported-chart', `chart ${chart.id} point ${p.key} has no value`);
        }
        return toChartNumber(raw, `${chart.id}/${p.key}`);
      }),
    };
  });
  const colors = seriesIds.map((series) => {
    const spec = chart.series.find((s) => s.id === series);
    return semanticColor(spec?.semantic ?? 'observed');
  });
  // Stored fractions display as whole percents on data labels; counts and
  // money keep the general format. (Labels never alter the cached values.)
  const labelFormat = chart.unit.kind === 'ratio' ? '0%' : undefined;
  const axisFont = ctx.rtl ? FONT_AR : FONT;
  ctx.deck.addChart('bar', data, {
    x: box.x, y: box.y, w: box.w, h: box.h,
    barDir: 'col',
    showLegend: seriesIds.length > 1,
    legendPos: 'b',
    legendFontSize: 10,
    legendFontFace: axisFont,
    legendColor: GRAY,
    showTitle: false,
    showValue: true,
    // pptxgenjs only emits dLblPos for clustered bars as ctr/inBase/inEnd;
    // omitting it keeps PowerPoint's default outEnd placement — labels sit
    // above each bar end, never clipped inside the plot.
    dataLabelColor: INK,
    dataLabelFontSize: 10,
    dataLabelFontFace: axisFont,
    ...(labelFormat !== undefined ? { dataLabelFormatCode: labelFormat } : {}),
    chartColors: colors,
    valAxisMinVal: Number(chart.domain.min),
    valAxisMaxVal: Number(chart.domain.max),
    valGridLine: { color: RULE, size: 0.5 },
    catAxisLineColor: GRAY,
    valAxisLineColor: GRAY,
    catAxisLabelFontSize: 11,
    catAxisLabelColor: GRAY,
    catAxisLabelFontFace: axisFont,
    valAxisLabelFontSize: 10,
    valAxisLabelColor: GRAY,
    valAxisLabelFontFace: axisFont,
  });
}

function spanTokens(ctx: LayoutContext, maxSpans = 3): string | null {
  for (const proof of ctx.model.provenance) {
    if (proof.selections.length === 0) continue;
    const tokens: string[] = [];
    let total = 0;
    for (const selection of proof.selections) {
      for (const span of selection.spans) {
        total += 1;
        if (tokens.length < maxSpans) tokens.push(`${span.start}–${span.end}`);
      }
    }
    void total;
    if (tokens.length > 0) return tokens.join(', ');
  }
  return null;
}

function coverageLine(ctx: LayoutContext): string | null {
  const key = ctx.model.scope.coverageNoteKey;
  return hasLabel(key) ? label(ctx.locale, key) : null;
}



/* ------------------------------------------------------------------ */
/* Slide 1 — From rows to a decision                                   */
/* ------------------------------------------------------------------ */

function layoutSummary(ctx: LayoutContext): void {
  const { model, slide, locale } = ctx;
  const finding = slide.findingIds.map((id) => ctx.findingById.get(id)).find((f) => f !== undefined)
    ?? model.findings[0];
  if (finding === undefined) {
    textBox(ctx, 'body', [{ text: label(locale, 'empty.noFindings') }], {
      x: LEFT_X, y: BODY_Y, w: LEFT_W, h: 0.6, fontSize: BODY_SIZE, color: GRAY,
    });
  } else {
    // Lead statement reads as a headline; evidence lines stay recessive.
    bar(ctx, 'finding-accent', LEFT_X, BODY_Y + 0.06, 0.07, 0.62, COBALT);
    textBox(ctx, 'headline', [{ text: label(locale, finding.titleKey) }], {
      x: LEFT_X + 0.28, y: BODY_Y, w: LEFT_W - 0.28, h: 0.75, fontSize: 22, bold: true, color: INK,
    });
    if (finding.metricIds.length > 8) {
      throw new ExportPptxError(
        'layout-overflow',
        `slide ${slide.id} finding carries ${finding.metricIds.length} metrics over the 8-line budget`,
      );
    }
    const annotated = finding.metricIds
      .map((id) => ctx.metricById.get(id))
      .filter((m) => m !== undefined);
    const lines: TextRun[] = [];
    for (const metric of annotated) {
      const runs = metricLineRuns(ctx, metric as Metric);
      runs.forEach((run, i) => {
        const last = i === runs.length - 1;
        lines.push({
          ...run,
          options: {
            ...(run.options ?? {}),
            ...(i === 0 ? { bullet: { code: '25AA' } } : {}),
            ...(last ? { breakLine: true, paraSpaceAfter: 10 } : {}),
          },
        });
      });
    }
    // The lead caveat lives in the footer; the body stays comparative.
    textBox(ctx, 'body', lines, {
      x: LEFT_X + 0.28, y: BODY_Y + 0.95, w: LEFT_W - 0.28, h: BODY_H - 0.95, fontSize: SMALL_SIZE + 2, color: INK,
    });
  }

  // Lineage visual: retained records against raw input on a surface card,
  // bars to scale, each labeled so the diagram needs no legend.
  ctx.deck.addShape('roundRect', {
    x: RIGHT_X - 0.22, y: BODY_Y - 0.05, w: RIGHT_W + 0.44, h: 3.05,
    rectRadius: 0.09, fill: { color: SURFACE }, line: { color: RULE, width: 0.75 },
    objectName: `${slide.id}-lineage-card`,
  });
  const { rawRows, retainedRows } = model.qualitySummary;
  const keptW = rawRows > 0 ? (RIGHT_W * retainedRows) / rawRows : 0;
  textBox(ctx, 'lineage-raw-label', [{ text: label(locale, 'common.rawInput') }], {
    x: RIGHT_X, y: 2.22, w: RIGHT_W, h: 0.3, fontSize: FOOT_SIZE, color: GRAY,
  });
  bar(ctx, 'lineage-raw', RIGHT_X, 2.5, RIGHT_W, 0.4, RULE);
  textBox(ctx, 'lineage-raw-value', [{ text: formatInteger(String(rawRows)) }], {
    x: RIGHT_X, y: 2.56, w: RIGHT_W - 0.1, h: 0.3, fontSize: FOOT_SIZE, color: INK, align: 'right',
  });
  textBox(ctx, 'lineage-kept-label', [{ text: label(locale, 'common.retained') }], {
    x: RIGHT_X, y: 3.14, w: RIGHT_W, h: 0.3, fontSize: FOOT_SIZE, color: GRAY,
  });
  bar(ctx, 'lineage-kept', RIGHT_X, 3.42, keptW, 0.4, COBALT);
  textBox(ctx, 'lineage-kept-value', [{ text: formatInteger(String(retainedRows)) }], {
    x: RIGHT_X, y: 3.48, w: RIGHT_W - 0.1, h: 0.3, fontSize: FOOT_SIZE, color: INK, align: 'right',
  });
  const disclosure = ctx.isSample ? label(locale, 'common.prepared') : label(locale, 'common.local');
  const coverage = coverageLine(ctx);
  const contextLines = coverage !== null ? `${disclosure} · ${coverage}` : disclosure;
  textBox(ctx, 'context', [{ text: contextLines }], {
    x: RIGHT_X, y: 4.14, w: RIGHT_W, h: 0.7, fontSize: FOOT_SIZE, color: GRAY,
  });
}

/* ------------------------------------------------------------------ */
/* Slide 2 — June at a glance                                          */
/* ------------------------------------------------------------------ */

function layoutKpis(ctx: LayoutContext): void {
  const { model, slide, locale } = ctx;
  const ids = slide.metricIds;
  if (ids.length === 0) {
    textBox(ctx, 'body', [{ text: label(locale, 'empty.noData') }], {
      x: LEFT_X, y: BODY_Y, w: 12.23, h: BODY_H, fontSize: BODY_SIZE, color: INK,
    });
    return;
  }
  const metrics = ids.map((id) => ctx.metricById.get(id)).filter((m) => m !== undefined) as Metric[];
  if (metrics.length > 6) {
    throw new ExportPptxError('layout-overflow', `slide ${slide.id} carries ${metrics.length} KPIs`);
  }
  const colW = 12.23 / Math.max(1, metrics.length);
  metrics.forEach((metric, i) => {
    const negative = metric.value !== null && metric.value.startsWith('-');
    const color = metric.unit.kind === 'ratio' && negative ? RED : INK;
    const big = metric.unit.kind === 'currency' && metric.value !== null
      ? `${exportUnitLabel(metric.unit)} ${formatCompact(metric.value)}`.trim()
      : formatMetricValue(metric.value, metric.unit);
    const name = metricDisplayName(ctx, metric, metrics);
    if (i > 0) {
      bar(ctx, `kpi-sep-${i}`, LEFT_X + i * colW - 0.07, BODY_Y + 0.08, 0.014, 1.35, RULE);
    }
    textBox(ctx, `kpi-${i}`, [
      { text: big, options: { breakLine: true } },
      { text: name, options: { fontSize: FOOT_SIZE, color: GRAY } },
    ], {
      x: LEFT_X + i * colW + (i > 0 ? 0.05 : 0), y: BODY_Y, w: colW - 0.12, h: 1.5, fontSize: big.length > 10 ? 21 : HEADLINE_SIZE, bold: true, color,
    });
  });
  // Native data panel: exact values under the headlines, header band on top.
  const header = [
    { text: label(locale, 'table.metric'), options: { bold: true, fill: { color: SURFACE } } },
    { text: label(locale, 'table.value'), options: { bold: true, fill: { color: SURFACE } } },
    { text: label(locale, 'table.unit'), options: { bold: true, fill: { color: SURFACE } } },
  ];
  const rows = [header, ...metrics.map((metric) => [
    { text: metricDisplayName(ctx, metric, metrics), options: {} },
    { text: formatMetricValue(metric.value, metric.unit), options: { bold: true } },
    { text: exportUnitLabel(metric.unit), options: { color: GRAY } },
  ])];
  fitGuard(slide.id, 'table', JSON.stringify(rows), SMALL_SIZE, 12.23, 1.9);
  ctx.deck.addTable(rows, {
    x: LEFT_X, y: 4.4, w: 12.23,
    colW: [5.5, 4.0, 2.73],
    fontSize: SMALL_SIZE, fontFace: ctx.rtl ? FONT_AR : FONT, color: INK,
    border: { pt: 0.5, color: RULE },
    objectName: `${slide.id}-table`,
  });
  if (model.scenario !== null && model.scenario.status === 'defined') {
    const line = label(locale, 'export.includesScenario').replace('{change}', formatPercent(model.scenario.costChange).replace('.0%', '%'));
    textBox(ctx, 'scenario-label', [{ text: line }], {
      x: LEFT_X, y: 6.3, w: 12.23, h: 0.4, fontSize: SMALL_SIZE, color: AMBER,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Slide 3 — finding with native comparison                            */
/* ------------------------------------------------------------------ */

function layoutFinding(ctx: LayoutContext): void {
  const { slide, locale } = ctx;
  const finding = slide.findingIds.map((id) => ctx.findingById.get(id)).find((f) => f !== undefined);
  if (finding === undefined) {
    textBox(ctx, 'body', [{ text: label(locale, 'empty.noFindings') }], {
      x: LEFT_X, y: BODY_Y, w: 12.23, h: BODY_H, fontSize: BODY_SIZE, color: INK,
    });
    return;
  }
  // Accent tick anchors the finding headline; metrics render label-dim,
  // value-strong so the numbers carry the scan order.
  bar(ctx, 'finding-accent', LEFT_X, BODY_Y + 0.06, 0.07, 0.62, COBALT);
  textBox(ctx, 'headline', [{ text: label(locale, finding.titleKey) }], {
    x: LEFT_X + 0.28, y: BODY_Y, w: LEFT_W - 0.28, h: 1.0, fontSize: 20, bold: true, color: INK,
  });
  // No silent truncation: an over-long metric list fails visibly instead
  // of clipping into unreadable overflow.
  if (finding.metricIds.length > 8) {
    throw new ExportPptxError(
      'layout-overflow',
      `slide ${slide.id} finding carries ${finding.metricIds.length} metrics over the 8-line budget`,
    );
  }
  const lines: TextRun[] = [];
  for (const metric of finding.metricIds
    .map((id) => ctx.metricById.get(id))
    .filter((m) => m !== undefined)) {
    const runs = metricLineRuns(ctx, metric as Metric);
    runs.forEach((run, i) => {
      const last = i === runs.length - 1;
      lines.push({
        ...run,
        options: {
          ...(run.options ?? {}),
          ...(last ? { breakLine: true, paraSpaceAfter: 8 } : {}),
        },
      });
    });
  }
  const coverage = coverageLine(ctx);
  if (coverage !== null) {
    lines.push({ text: coverage, options: { fontSize: SMALL_SIZE, color: GRAY, breakLine: true, paraSpaceBefore: 8 } });
  }
  textBox(ctx, 'body', lines, { x: LEFT_X + 0.28, y: BODY_Y + 1.1, w: LEFT_W - 0.28, h: BODY_H - 1.1, fontSize: BODY_SIZE - 2, color: INK });

  const chartId = slide.chartIds.find((id) => ctx.chartById.has(id));
  if (chartId !== undefined) {
    chartBox(ctx, chartId, { x: RIGHT_X, y: BODY_Y, w: RIGHT_W, h: BODY_H });
  } else {
    const spans = spanTokens(ctx);
    const detail = spans !== null
      ? `${label(locale, 'evidence.sourceRows')}: ${spans}`
      : label(locale, 'empty.noData');
    textBox(ctx, 'detail', [{ text: detail }], {
      x: RIGHT_X, y: BODY_Y, w: RIGHT_W, h: BODY_H, fontSize: 16, color: GRAY,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Slide 4 — cost assumption before/after                              */
/* ------------------------------------------------------------------ */

function layoutScenario(ctx: LayoutContext): void {
  const { model, slide, locale } = ctx;
  const scenario = model.scenario;
  if (scenario === null || scenario.status !== 'defined') {
    // Designed empty state: a quiet panel that states what this page
    // would have shown and why it cannot — never naked text on paper.
    const reason = scenario === null
      ? label(locale, 'scenario.notCommitted')
      : scenario.reasonKey !== null && scenario.reasonKey !== undefined && hasLabel(scenario.reasonKey)
        ? label(locale, scenario.reasonKey)
        : label(locale, 'scenario.unavailable');
    ctx.deck.addShape('roundRect', {
      x: LEFT_X, y: BODY_Y + 0.3, w: 8.6, h: 2.9,
      rectRadius: 0.09, fill: { color: SURFACE }, line: { color: RULE, width: 0.75 },
      objectName: `${slide.id}-empty-panel`,
    });
    textBox(ctx, 'empty', [
      { text: label(locale, 'scenario.layer'), options: { fontSize: FOOT_SIZE, color: AMBER, bold: true, breakLine: true } },
      { text: label(locale, 'scenario.question'), options: { bold: true, fontSize: 20, breakLine: true, paraSpaceBefore: 6 } },
      { text: reason, options: { fontSize: SMALL_SIZE, color: GRAY, paraSpaceBefore: 8 } },
    ], {
      x: LEFT_X + 0.45, y: BODY_Y + 0.62, w: 7.7, h: 2.3, fontSize: BODY_SIZE, color: INK, valign: 'top',
    });
    return;
  }
  const byId = new Map(scenario.metrics.map((m) => [m.id, m] as const));
  const cost = byId.get('scenario-cost');
  const contribution = byId.get('scenario-contribution');
  const margin = byId.get('scenario-margin');
  // Amber marks the editable assumption layer everywhere it appears —
  // kicker tag, tick, and the scenario metric values themselves.
  bar(ctx, 'scenario-accent', LEFT_X, BODY_Y + 0.06, 0.07, 0.62, AMBER);
  textBox(ctx, 'kicker', [{ text: label(locale, 'scenario.layer') }], {
    x: LEFT_X + 0.28, y: BODY_Y - 0.05, w: LEFT_W - 0.28, h: 0.3, fontSize: FOOT_SIZE, bold: true, color: AMBER,
  });
  textBox(ctx, 'headline', [{ text: label(locale, 'scenario.question') }], {
    x: LEFT_X + 0.28, y: BODY_Y + 0.3, w: LEFT_W - 0.28, h: 0.9, fontSize: 20, bold: true, color: INK,
  });
  const lines: TextRun[] = [];
  const amberLine = (name: string, m: Metric): void => {
    lines.push({ text: `${name}  `, options: { color: GRAY } });
    lines.push({ text: formatMetricValue(m.value, m.unit), options: { color: AMBER, bold: true, breakLine: true, paraSpaceAfter: 8 } });
  };
  if (cost !== undefined) amberLine(label(locale, 'scenario.costChange'), cost);
  if (contribution !== undefined) amberLine(label(locale, 'metric.contribution'), contribution);
  if (margin !== undefined) amberLine(label(locale, 'metric.margin'), margin);
  const notes: TextRun[] = [
    { text: label(locale, 'limitations.noForecast'), options: { fontSize: SMALL_SIZE, color: GRAY, breakLine: true } },
  ];
  if (scenario.definitionId === 'operating-cost-v1') {
    notes.push({ text: label(locale, 'scenario.assumption.revenueFixed'), options: { fontSize: SMALL_SIZE, color: GRAY, breakLine: true } });
    notes.push({ text: label(locale, 'scenario.assumption.mechanical'), options: { fontSize: SMALL_SIZE, color: GRAY } });
  }
  textBox(ctx, 'body', lines, {
    x: LEFT_X + 0.28, y: BODY_Y + 1.25, w: LEFT_W - 0.28, h: 1.8, fontSize: BODY_SIZE, color: INK,
  });
  textBox(ctx, 'assumptions', notes, {
    x: LEFT_X + 0.28, y: BODY_Y + 3.0, w: LEFT_W - 0.28, h: 0.85, fontSize: SMALL_SIZE, color: GRAY,
  });

  const chartId = slide.chartIds.find((id) => ctx.chartById.has(id));
  if (chartId !== undefined) {
    chartBox(ctx, chartId, { x: RIGHT_X, y: BODY_Y, w: RIGHT_W, h: BODY_H });
  } else if (scenario.definitionId === 'operating-cost-v1') {
    textBox(ctx, 'detail', [
      { text: label(locale, 'scenario.assumption.revenueFixed'), options: { breakLine: true } },
      { text: label(locale, 'scenario.assumption.mechanical'), options: { breakLine: true } },
    ], { x: RIGHT_X, y: BODY_Y, w: RIGHT_W, h: BODY_H, fontSize: 16, color: GRAY });
  } else {
    textBox(ctx, 'detail', [{ text: label(locale, 'empty.noData') }], {
      x: RIGHT_X, y: BODY_Y, w: RIGHT_W, h: BODY_H, fontSize: 16, color: GRAY,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Slide 5 — quality reconciliation                                    */
/* ------------------------------------------------------------------ */

function layoutQuality(ctx: LayoutContext): void {
  const { model, locale, slide } = ctx;
  const trio = (['quality-duplicate', 'quality-category', 'quality-missing'] as const)
    .map((id) => ctx.metricById.get(id))
    .filter((m) => m !== undefined) as Metric[];
  const counts = trio.map((m) => Number(m.value ?? '0'));
  const peak = Math.max(1, ...counts);
  trio.forEach((metric, i) => {
    const count = counts[i] as number;
    const y = BODY_Y + i * 0.95;
    textBox(ctx, `q-label-${i}`, [
      { text: `${hasLabel(metric.labelKey) ? label(locale, metric.labelKey) : metric.id}  `, options: { color: GRAY } },
      { text: formatInteger(metric.value ?? '0'), options: { color: INK, bold: true } },
    ], { x: LEFT_X, y, w: LEFT_W, h: 0.5, fontSize: 16, color: INK });
    // Track bar shows the shared scale; the filled bar reads against it.
    bar(ctx, `q-track-${i}`, LEFT_X, y + 0.52, LEFT_W, 0.26, RULE);
    bar(ctx, `q-bar-${i}`, LEFT_X, y + 0.52, (LEFT_W * count) / peak, 0.26, i === 0 ? COBALT : i === 1 ? SLATE : AMBER);
  });
  const { issueCount, resolved, unresolved } = model.qualitySummary;
  ctx.deck.addShape('roundRect', {
    x: RIGHT_X - 0.22, y: BODY_Y - 0.05, w: RIGHT_W + 0.44, h: 3.0,
    rectRadius: 0.09, fill: { color: SURFACE }, line: { color: RULE, width: 0.75 },
    objectName: `${slide.id}-reconcile-card`,
  });
  textBox(ctx, 'reconcile', [
    { text: label(locale, 'quality.reconciliation'), options: { fontSize: FOOT_SIZE, bold: true, color: GRAY, breakLine: true, paraSpaceAfter: 12 } },
    { text: `${label(locale, 'quality.resolved')}  `, options: { color: GRAY } },
    { text: formatInteger(String(resolved)), options: { bold: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: `${label(locale, 'quality.unresolved')}  `, options: { color: GRAY } },
    { text: formatInteger(String(unresolved)), options: { bold: true, breakLine: true, paraSpaceAfter: 12 } },
    { text: `${label(locale, 'quality.issues')}  `, options: { fontSize: SMALL_SIZE, color: GRAY } },
    { text: formatInteger(String(issueCount)), options: { fontSize: SMALL_SIZE, color: INK, bold: true, breakLine: true, paraSpaceAfter: 10 } },
    { text: label(locale, 'quality.noImputation'), options: { fontSize: FOOT_SIZE, color: GRAY } },
  ], { x: RIGHT_X + 0.25, y: BODY_Y + 0.3, w: RIGHT_W - 0.5, h: 2.5, fontSize: BODY_SIZE, color: INK, valign: 'top' });
}

/* ------------------------------------------------------------------ */
/* Slide 6 — source and limits                                         */
/* ------------------------------------------------------------------ */

function layoutMethodology(ctx: LayoutContext): void {
  const { model, locale } = ctx;
  const ref = model.table.sourceRef;
  const lines: Array<{ text: string; options?: Record<string, unknown> }> = [
    { text: label(locale, 'common.source'), options: { bold: true, fontSize: FOOT_SIZE, color: GRAY, breakLine: true, paraSpaceAfter: 8 } },
    { text: ref.workbookName, options: { breakLine: true } },
    { text: `${label(locale, 'common.sheet')}: ${ref.sheetName}`, options: { breakLine: true } },
    { text: `${label(locale, 'evidence.hash')}: ${model.sourceHash.slice(0, 12)}`, options: { breakLine: true } },
    {
      text: `${formatInteger(String(model.qualitySummary.retainedRows))} / ${formatInteger(String(model.qualitySummary.rawRows))} ${label(locale, 'common.rows')}`,
      options: { breakLine: true },
    },
  ];
  const spans = spanTokens(ctx);
  if (spans !== null) {
    lines.push({ text: `${label(locale, 'evidence.sourceRows')}: ${spans}`, options: { breakLine: true } });
  }
  const limits = [...new Set(model.findings.flatMap((f) => f.limitations))]
    .filter((key) => hasLabel(key))
    .slice(0, 3);
  for (const key of limits) {
    lines.push({ text: label(locale, key), options: { fontSize: SMALL_SIZE, color: GRAY, breakLine: true } });
  }
  if (!limits.includes('limitations.noForecast') && hasLabel('limitations.noForecast')) {
    lines.push({ text: label(locale, 'limitations.noForecast'), options: { fontSize: SMALL_SIZE, color: GRAY } });
  }
  textBox(ctx, 'body', lines, { x: LEFT_X, y: BODY_Y, w: LEFT_W, h: BODY_H, fontSize: 16, color: INK });
  const verified = model.provenance.slice(0, 2).map((proof) => {
    const metric = model.metrics.find((m) => m.provenanceId === proof.id);
    const name = metric !== undefined && hasLabel(metric.labelKey)
      ? label(locale, metric.labelKey)
      : label(locale, 'evidence.calculation');
    const shown = metric !== undefined && metric.value !== null
      ? formatMetricValue(metric.value, metric.unit)
      : (proof.result ?? '');
    return { text: `${name} = ${shown}`, options: { breakLine: true, paraSpaceAfter: 8 } };
  });
  textBox(ctx, 'trace', [
    { text: label(locale, 'common.verified'), options: { bold: true, fontSize: FOOT_SIZE, color: GRAY, breakLine: true, paraSpaceAfter: 12 } },
    ...verified,
  ], { x: RIGHT_X, y: BODY_Y, w: RIGHT_W, h: 1.6, fontSize: SMALL_SIZE, color: INK });
}

export function renderSlide(ctx: LayoutContext): void {
  chrome(ctx);
  switch (ctx.slide.kind) {
    case 'summary':
      layoutSummary(ctx);
      break;
    case 'kpis':
      layoutKpis(ctx);
      break;
    case 'finding':
      layoutFinding(ctx);
      break;
    case 'scenario':
      layoutScenario(ctx);
      break;
    case 'quality':
      layoutQuality(ctx);
      break;
    case 'methodology':
      layoutMethodology(ctx);
      break;
    default:
      layoutFinding(ctx);
      break;
  }
}
