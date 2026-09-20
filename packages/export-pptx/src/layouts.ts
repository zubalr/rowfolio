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
import { isDecimal } from '@rowfolio/contracts';
import type {
  ChartSpec,
  ExportModel,
  Finding,
  Locale,
  Metric,
  SlideModel,
} from '@rowfolio/contracts';
import { ExportPptxError } from './presentation.ts';
import { hasLabel, label } from './labels.ts';
import {
  formatCompact,
  formatInteger,
  formatMetricValue,
  formatPercent,
} from './format.ts';

type Deck = ReturnType<InstanceType<typeof PptxGenJS>['addSlide']>;

const INK = '1A1A1A';
const COBALT = '1D4ED8';
const AMBER = 'D97706';
/** Restrained adverse red, re-exported for compatibility. */
export const RED = 'B91C1C';
const SLATE = '64748B';
const GRAY = '555555';
const PAPER = 'F8F5EC';
const FONT = 'Arial';

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

function runsFor(text: string, locale: Locale): Array<{ text: string; options: { rtlMode: boolean } }> {
  if (locale === 'en') return [{ text, options: { rtlMode: false } }];
  const parts = text.split(/([0-9][0-9.,%]*|[A-Za-z_][A-Za-z0-9_.:-]*)/g).filter((p) => p !== '');
  return parts.map((part) => ({
    text: part,
    options: { rtlMode: /^[0-9A-Za-z_]/.test(part) ? false : true },
  }));
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

function metricLine(ctx: LayoutContext, metric: Metric): string {
  const name = hasLabel(metric.labelKey) ? label(ctx.locale, metric.labelKey) : metric.id;
  return `${name}: ${formatMetricValue(metric.value, metric.unit.kind, metric.unit.label)}`;
}

function chrome(ctx: LayoutContext): void {
  const { deck, slide, locale, rtl, align } = ctx;
  deck.background = { color: PAPER };
  deck.addText(runsFor(slide.title, locale), {
    x: LEFT_X, y: 0.35, w: 12.23, h: 1.0,
    fontSize: TITLE_SIZE, fontFace: FONT, bold: true, color: INK,
    align, rtlMode: rtl, objectName: `${slide.id}-title`,
  });
  deck.addText(runsFor(slide.subtitle, locale), {
    x: LEFT_X, y: 1.35, w: 12.23, h: 0.5,
    fontSize: SUBTITLE_SIZE, fontFace: FONT, color: GRAY,
    align, rtlMode: rtl, objectName: `${slide.id}-subtitle`,
  });
  const notes = slide.notes.join(' · ');
  // Visible footer carries human evidence pointers only; raw IDs live in
  // speaker notes and object names, never in display text.
  const footer = footerContent(ctx);
  if (footer !== null) {
    deck.addText(runsFor(footer, locale), {
      x: LEFT_X, y: FOOT_Y, w: 12.23, h: 0.5,
      fontSize: FOOT_SIZE, fontFace: FONT, color: '666666',
      align, rtlMode: rtl, objectName: `${slide.id}-notes`,
    });
  }
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
  box: { x: number; y: number; w: number; h: number; fontSize: number; color?: string; bold?: boolean; align?: 'left' | 'right' | 'center' },
): void {
  const plain = runs.map((r) => r.text ?? '').join('');
  fitGuard(ctx.slide.id, name, plain, box.fontSize, box.w, box.h);
  ctx.deck.addText(runs, {
    x: box.x, y: box.y, w: box.w, h: box.h,
    fontSize: box.fontSize, fontFace: FONT,
    color: box.color ?? INK, bold: box.bold ?? false,
    align: box.align ?? ctx.align, rtlMode: ctx.rtl,
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
  ctx.deck.addChart('bar', data, {
    x: box.x, y: box.y, w: box.w, h: box.h,
    barDir: 'col',
    showLegend: seriesIds.length > 1,
    showTitle: false,
    showValue: true,
    dataLabelFontSize: 11,
    ...(labelFormat !== undefined ? { dataLabelFormatCode: labelFormat } : {}),
    chartColors: colors,
    valAxisMinVal: Number(chart.domain.min),
    valAxisMaxVal: Number(chart.domain.max),
    catAxisLabelFontSize: 11,
    valAxisLabelFontSize: 11,
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

/** Visible unit code: stored fractions display under `%`, never `fraction`. */
function displayUnit(unitKind: string, unitLabel: string): string {
  if (unitKind === 'ratio') return '%';
  return unitLabel;
}

/* ------------------------------------------------------------------ */
/* Slide 1 — From rows to a decision                                   */
/* ------------------------------------------------------------------ */

function layoutSummary(ctx: LayoutContext): void {
  const { model, slide, locale } = ctx;
  const finding = slide.findingIds.map((id) => ctx.findingById.get(id)).find((f) => f !== undefined)
    ?? model.findings[0];
  const left: Array<{ text: string; options?: Record<string, unknown> }> = [];
  if (finding === undefined) {
    left.push({ text: label(locale, 'empty.noFindings') });
  } else {
    left.push({ text: label(locale, finding.titleKey), options: { bold: true, fontSize: 20 } });
    if (finding.metricIds.length > 8) {
      throw new ExportPptxError(
        'layout-overflow',
        `slide ${slide.id} finding carries ${finding.metricIds.length} metrics over the 8-line budget`,
      );
    }
    const annotated = finding.metricIds
      .map((id) => ctx.metricById.get(id))
      .filter((m) => m !== undefined);
    for (const metric of annotated) {
      left.push({ text: metricLine(ctx, metric as Metric) });
    }
    // The lead caveat lives in the footer; the body stays comparative.
  }
  textBox(ctx, 'body', left.map((line) => ({
    ...line,
    options: { ...(line.options ?? {}), bullet: { code: '25AA' }, breakLine: true },
  })), { x: LEFT_X, y: BODY_Y, w: LEFT_W, h: BODY_H, fontSize: BODY_SIZE, color: COBALT });

  // Lineage visual: retained records against raw input, widths to scale.
  const { rawRows, retainedRows } = model.qualitySummary;
  const rowsLabel = label(locale, 'common.rows');
  const keptW = rawRows > 0 ? (RIGHT_W * retainedRows) / rawRows : 0;
  bar(ctx, 'lineage-raw', RIGHT_X, 2.4, RIGHT_W, 0.55, 'D8D2C4');
  bar(ctx, 'lineage-kept', RIGHT_X, 3.2, keptW, 0.55, COBALT);
  const keptText = `${formatInteger(String(retainedRows))} / ${formatInteger(String(rawRows))} ${rowsLabel}`;
  textBox(ctx, 'lineage', [{ text: keptText }], {
    x: RIGHT_X, y: 3.95, w: RIGHT_W, h: 0.6, fontSize: SMALL_SIZE, color: INK,
  });
  const disclosure = ctx.isSample ? label(locale, 'common.prepared') : label(locale, 'common.local');
  const coverage = coverageLine(ctx);
  const contextLines = coverage !== null ? `${disclosure} · ${coverage}` : disclosure;
  textBox(ctx, 'context', [{ text: contextLines }], {
    x: RIGHT_X, y: 4.7, w: RIGHT_W, h: 1.2, fontSize: SMALL_SIZE, color: GRAY,
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
      ? `${metric.unit.label} ${formatCompact(metric.value)}`
      : formatMetricValue(metric.value, metric.unit.kind, metric.unit.label);
    const name = hasLabel(metric.labelKey) ? label(locale, metric.labelKey) : metric.id;
    textBox(ctx, `kpi-${i}`, [
      { text: big, options: { breakLine: true } },
      { text: name, options: { fontSize: 14, color: GRAY } },
    ], {
      x: LEFT_X + i * colW, y: BODY_Y, w: colW - 0.15, h: 1.6, fontSize: HEADLINE_SIZE, bold: true, color,
    });
  });
  // Native data panel: exact values beside the headlines.
  const rows = metrics.map((metric) => [
    { text: hasLabel(metric.labelKey) ? label(locale, metric.labelKey) : metric.id, options: {} },
    { text: formatMetricValue(metric.value, metric.unit.kind, metric.unit.label), options: {} },
    { text: displayUnit(metric.unit.kind, metric.unit.label), options: {} },
  ]);
  fitGuard(slide.id, 'table', JSON.stringify(rows), SMALL_SIZE, 12.23, 1.9);
  ctx.deck.addTable(rows, {
    x: LEFT_X, y: 4.4, w: 12.23,
    colW: [5.5, 4.0, 2.73],
    fontSize: SMALL_SIZE, fontFace: FONT, color: INK,
    border: { pt: 0.5, color: 'D8D2C4' },
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
  const lines: Array<{ text: string; options?: Record<string, unknown> }> = [
    { text: label(locale, finding.titleKey), options: { bold: true, fontSize: 20 } },
  ];
  // No silent truncation: an over-long metric list fails visibly instead
  // of clipping into unreadable overflow.
  if (finding.metricIds.length > 8) {
    throw new ExportPptxError(
      'layout-overflow',
      `slide ${slide.id} finding carries ${finding.metricIds.length} metrics over the 8-line budget`,
    );
  }
  for (const metric of finding.metricIds
    .map((id) => ctx.metricById.get(id))
    .filter((m) => m !== undefined)) {
    lines.push({ text: metricLine(ctx, metric as Metric) });
  }
  const coverage = coverageLine(ctx);
  if (coverage !== null) {
    lines.push({ text: coverage, options: { fontSize: SMALL_SIZE, color: GRAY } });
  }
  textBox(ctx, 'body', lines.map((line) => ({
    ...line,
    options: { ...(line.options ?? {}), breakLine: true },
  })), { x: LEFT_X, y: BODY_Y, w: LEFT_W, h: BODY_H, fontSize: BODY_SIZE, color: INK });

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
    const reason = scenario?.reasonKey !== null && scenario?.reasonKey !== undefined && hasLabel(scenario.reasonKey)
      ? label(locale, scenario.reasonKey)
      : label(locale, 'scenario.unavailable');
    textBox(ctx, 'body', [
      { text: label(locale, 'scenario.question'), options: { bold: true, fontSize: 20 } },
      { text: reason },
      { text: label(locale, 'empty.noData'), options: { fontSize: SMALL_SIZE, color: GRAY } },
    ].map((line) => ({ ...line, options: { ...(line.options ?? {}), breakLine: true } })), {
      x: LEFT_X, y: BODY_Y, w: 12.23, h: BODY_H, fontSize: BODY_SIZE, color: INK,
    });
    return;
  }
  const byId = new Map(scenario.metrics.map((m) => [m.id, m] as const));
  const cost = byId.get('scenario-cost');
  const contribution = byId.get('scenario-contribution');
  const margin = byId.get('scenario-margin');
  const lines: Array<{ text: string; options?: Record<string, unknown> }> = [
    { text: label(locale, 'scenario.question'), options: { bold: true, fontSize: 20 } },
  ];
  if (cost !== undefined) lines.push({ text: `${label(locale, 'scenario.costChange')}: ${formatMetricValue(cost.value, cost.unit.kind, cost.unit.label)}`, options: { color: AMBER } });
  if (contribution !== undefined) {
    lines.push({ text: `${label(locale, 'metric.contribution')}: ${formatMetricValue(contribution.value, contribution.unit.kind, contribution.unit.label)}`, options: { color: AMBER } });
  }
  if (margin !== undefined) {
    lines.push({ text: `${label(locale, 'metric.margin')}: ${formatMetricValue(margin.value, margin.unit.kind, margin.unit.label)}`, options: { color: AMBER } });
  }
  lines.push({ text: label(locale, 'limitations.noForecast'), options: { fontSize: SMALL_SIZE, color: GRAY } });
  if (scenario.definitionId === 'operating-cost-v1') {
    lines.push({ text: label(locale, 'scenario.assumption.revenueFixed'), options: { fontSize: SMALL_SIZE, color: GRAY } });
    lines.push({ text: label(locale, 'scenario.assumption.mechanical'), options: { fontSize: SMALL_SIZE, color: GRAY } });
  }
  textBox(ctx, 'body', lines.map((line) => ({
    ...line,
    options: { ...(line.options ?? {}), breakLine: true },
  })), { x: LEFT_X, y: BODY_Y, w: LEFT_W, h: BODY_H, fontSize: BODY_SIZE, color: INK });

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
  const { model, locale } = ctx;
  const trio = (['quality-duplicate', 'quality-category', 'quality-missing'] as const)
    .map((id) => ctx.metricById.get(id))
    .filter((m) => m !== undefined) as Metric[];
  const counts = trio.map((m) => Number(m.value ?? '0'));
  const peak = Math.max(1, ...counts);
  trio.forEach((metric, i) => {
    const count = counts[i] as number;
    const y = BODY_Y + i * 0.85;
    textBox(ctx, `q-label-${i}`, [{
      text: `${hasLabel(metric.labelKey) ? label(locale, metric.labelKey) : metric.id}: ${formatInteger(metric.value ?? '0')}`,
    }], { x: LEFT_X, y, w: LEFT_W, h: 0.55, fontSize: 16, color: INK });
    bar(ctx, `q-bar-${i}`, LEFT_X, y + 0.5, (LEFT_W * count) / peak, 0.28, i === 0 ? COBALT : i === 1 ? SLATE : AMBER);
  });
  const { issueCount, resolved, unresolved } = model.qualitySummary;
  textBox(ctx, 'reconcile', [
    { text: `${label(locale, 'quality.resolved')}: ${formatInteger(String(resolved))}`, options: { breakLine: true } },
    { text: `${label(locale, 'quality.unresolved')}: ${formatInteger(String(unresolved))}`, options: { breakLine: true } },
    { text: `${label(locale, 'quality.noImputation')}`, options: { fontSize: SMALL_SIZE, color: GRAY, breakLine: true } },
    { text: `${label(locale, 'quality.issues')}: ${formatInteger(String(issueCount))}`, options: { fontSize: SMALL_SIZE, color: GRAY } },
  ], { x: RIGHT_X, y: BODY_Y, w: RIGHT_W, h: BODY_H, fontSize: BODY_SIZE, color: INK });
}

/* ------------------------------------------------------------------ */
/* Slide 6 — source and limits                                         */
/* ------------------------------------------------------------------ */

function layoutMethodology(ctx: LayoutContext): void {
  const { model, locale } = ctx;
  const ref = model.table.sourceRef;
  const lines: Array<{ text: string; options?: Record<string, unknown> }> = [
    { text: `${label(locale, 'common.source')}: ${ref.workbookName}`, options: { breakLine: true } },
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
      ? formatMetricValue(metric.value, metric.unit.kind, metric.unit.label)
      : (proof.result ?? '');
    return { text: `${name} = ${shown}`, options: { breakLine: true } };
  });
  textBox(ctx, 'trace', [
    ...verified,
    { text: label(locale, 'common.verified'), options: { fontSize: SMALL_SIZE, color: GRAY } },
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
