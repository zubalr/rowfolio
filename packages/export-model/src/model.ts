/**
 * Shared briefing model builder: one immutable localized ExportModel for
 * both native writers. Writers preserve these values and provenance —
 * they never recompute analytical meaning.
 *
 * Sample narrative prose is pre-authored per locale and gated on the
 * sample's required metric ids; anything else gets neutral descriptive
 * copy instead of invented management advice. All copy respects fixed
 * text budgets (titles, subtitles, notes) with separate Arabic
 * compositions — never reversed strings.
 */
import {
  compareDecimal,
  deepEqual,
  isDecimal,
  multiplyDecimal,
  normalizeDecimalString,
} from '@rowfolio/contracts';
import type {
  AnalysisSnapshot,
  ChartSpec,
  ExportModel,
  Locale,
  Metric,
  NormalizedTable,
  ScenarioResult,
  SheetModel,
  SlideModel,
  Unit,
} from '@rowfolio/contracts';

export class ExportModelError extends Error {
  readonly code:
    | 'stale-snapshot'
    | 'scenario-mismatch'
    | 'invalid-created-at'
    | 'budget-exceeded';
  constructor(code: ExportModelError['code'], message: string) {
    super(message);
    this.name = 'ExportModelError';
    this.code = code;
  }
}

export const TEMPLATE_VERSION = '1.0.0';
const TITLE_BUDGET = 60;
const SUBTITLE_BUDGET = 80;
const NOTE_BUDGET = 200;

const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
// Arabic renders thousands with ٬ and decimals with ٫ — Latin separators
// left inside otherwise-localized numbers read as a mix on the surface.
const ARABIC_SEPARATORS: Record<string, string> = { ',': '٬', '.': '٫' };

export function localizeDigits(text: string, numbering: 'latn' | 'arab'): string {
  if (numbering === 'latn') return text;
  return text.replace(/[0-9]|,|\./g, (c) => (ARABIC_DIGITS[Number(c)] as string) ?? ARABIC_SEPARATORS[c] ?? c);
}

/** `2026-06-01..2026-06-30` → `June 2026` (locale-composed, numbering-aware). */
export function periodLabel(start: string | null, end: string | null, locale: Locale, numbering: 'latn' | 'arab'): string {
  if (start === null || end === null) {
    return locale === 'ar' ? 'كل الفترات' : 'All periods';
  }
  const month = Number(start.slice(5, 7));
  const year = start.slice(0, 4);
  const name = (locale === 'ar' ? AR_MONTHS : EN_MONTHS)[month - 1] as string;
  return localizeDigits(`${name} ${year}`, numbering);
}

/**
 * Display unit for a metric in export artifacts. Engines emit placeholder
 * labels ("unit", "fraction") that must never reach visible copy: ratios
 * display as `%`, currencies fall back to their ISO code, and other
 * placeholders suppress to empty. Real labels pass through trimmed.
 * Mirrors the workspace badge rule (`metricUnitLabel`) with a populated
 * unit column: suppression returns `''` where the app hides the badge.
 */
export function exportUnitLabel(unit: Unit, labeler?: (key: string) => string): string {
  switch (unit.kind) {
    case 'currency':
      return unit.label === 'unit' || unit.label === '' ? (unit.currency ?? '') : unit.label;
    case 'ratio':
      return '%';
    default: {
      const label = unit.label.trim();
      if (label === 'unit' || label === 'fraction') return '';
      const key = UNIT_LABEL_KEYS[label];
      if (key !== undefined && labeler !== undefined) return labeler(key);
      return label;
    }
  }
}

/**
 * Engine-emitted unit labels that have catalog translations. Everything
 * else passes through as user data (units come from the workbook itself).
 */
const UNIT_LABEL_KEYS: Record<string, string> = {
  records: 'unit.records',
};

/**
 * Catalog key for a placeholder-free unit label, or null when the unit
 * label is user data / suppressed. Callers with a locale table resolve
 * the key; those without one get the raw label via exportUnitLabel.
 */
export function unitLabelKey(unit: Unit): string | null {
  const key = UNIT_LABEL_KEYS[unit.label.trim()];
  return key ?? null;
}

/** Lowercase ASCII slug for user-facing filenames; empty → 'report'. */
function fileSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.(xlsx|xls|csv)$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug === '' ? 'report' : slug;
}

/**
 * User-facing artifact filename: workbook name + period + locale,
 * e.g. `rowfolio-sample-operations-june-2026-en.xlsx`. The internal
 * exportId stays out of filenames — it belongs to diagnostics, not to
 * something a reader keeps.
 */
export function exportFileName(model: ExportModel, ext: 'xlsx' | 'pptx'): string {
  const name = fileSlug(model.table.sourceRef.workbookName);
  const start = model.scope.periodStart;
  const period = start === null ? 'all-periods' : start.slice(0, 7);
  const scenario = model.scenario !== null && model.scenario.status === 'defined' ? '-scenario' : '';
  return `rowfolio-${name}-${period}${scenario}-${model.locale}.${ext}`;
}

/**
 * Metric ids only the versioned sample rule pack emits (packages/analysis
 * gates them behind samplePolicyId), so their presence identifies the sample
 * regardless of whether a scenario was committed.
 */
const SAMPLE_REQUIRED_IDS = [
  'june-revenue',
  'june-operating-cost',
  'june-contribution',
  'june-margin',
  'north-target-gap',
  'north-orders-change',
];

/**
 * Sample-ness is a property of the analyzed data, not of whether a scenario
 * was committed — a baseline export of the sample is still the example
 * report, and must not be titled 'User upload'.
 */
export function isSampleModel(snapshot: AnalysisSnapshot, scenario: ScenarioResult | null): boolean {
  void scenario;
  const ids = new Set(snapshot.metrics.map((m) => m.id));
  return SAMPLE_REQUIRED_IDS.every((id) => ids.has(id));
}

interface SlideCopy {
  readonly title: string;
  readonly subtitle: string;
}

const SAMPLE_TITLES: Record<Locale, string[]> = {
  en: [
    'Monthly operations report',
    'June at a glance',
    'North revenue sits under target even as orders climbed',
    'Change operating costs',
    'What changed in the data',
    'Inspect before acting',
  ],
  ar: [
    'تقرير العمليات الشهري',
    'يونيو في لمحة',
    'إيرادات الشمال دون المستهدف رغم ارتفاع الطلبات',
    'غيّر تكاليف التشغيل',
    'ما الذي تغيّر في البيانات؟',
    'تحقّق قبل اتخاذ القرار',
  ],
};

const SAMPLE_SUBTITLE_PREFIX: Record<Locale, string> = {
  en: 'Example analysis',
  ar: 'تحليل نموذجي',
};

const GENERIC_TITLES: Record<Locale, string[]> = {
  en: [
    'Data briefing',
    'Key figures',
    'Finding',
    'Cost sensitivity',
    'Data quality',
    'Method and limits',
  ],
  ar: [
    'إحاطة البيانات',
    'الأرقام الرئيسية',
    'استنتاج',
    'حساسية التكاليف',
    'جودة البيانات',
    'المنهجية والحدود',
  ],
};

const SHEET_NAMES: Record<Locale, [string, string, string, string, string]> = {
  en: ['Executive Summary', 'Cleaned Data', 'Data Quality', 'KPI Analysis', 'Methodology'],
  ar: ['الملخص التنفيذي', 'البيانات المنقحة', 'جودة البيانات', 'المؤشرات', 'المنهجية'],
};

/**
 * Copy tables are indexed by slide kind, not by deck position — a deck
 * without a committed scenario omits its scenario slide, shifting the
 * positions of the quality and methodology pages behind it.
 */
const KIND_COPY_INDEX: Record<SlideModel['kind'], number> = {
  summary: 0,
  kpis: 1,
  finding: 2,
  scenario: 3,
  quality: 4,
  methodology: 5,
  descriptive: 2,
};

function slideCopy(
  kind: SlideModel['kind'],
  locale: Locale,
  numbering: 'latn' | 'arab',
  snapshot: AnalysisSnapshot,
  isSample: boolean,
): SlideCopy {
  const index = KIND_COPY_INDEX[kind];
  if (isSample) {
    // Period resolves through the model's numbering system so the subtitle's
    // digits match the rest of the deck (يونيو 2026 vs يونيو ٢٠٢٦).
    const period = periodLabel(snapshot.scope.periodStart, snapshot.scope.periodEnd, locale, numbering);
    return {
      title: (SAMPLE_TITLES[locale][index] as string),
      subtitle: `${SAMPLE_SUBTITLE_PREFIX[locale]} · ${period}`,
    };
  }
  const period = periodLabel(snapshot.scope.periodStart, snapshot.scope.periodEnd, locale, numbering);
  const upload = locale === 'ar' ? 'ملف مرفوع' : 'User upload';
  return {
    title: (GENERIC_TITLES[locale][index] as string),
    subtitle: `${upload} / ${period}`,
  };
}

function checkBudgets(slides: SlideModel[]): void {
  slides.forEach((slide, i) => {
    if (slide.title.length > TITLE_BUDGET) {
      throw new ExportModelError('budget-exceeded', `slide ${i + 1} title exceeds ${TITLE_BUDGET} characters`);
    }
    if (slide.subtitle.length > SUBTITLE_BUDGET) {
      throw new ExportModelError('budget-exceeded', `slide ${i + 1} subtitle exceeds ${SUBTITLE_BUDGET} characters`);
    }
    for (const note of slide.notes) {
      if (note.length > NOTE_BUDGET) {
        throw new ExportModelError('budget-exceeded', `slide ${i + 1} note exceeds ${NOTE_BUDGET} characters`);
      }
    }
  });
}

/** Baseline margin id behind the scenario delta (the non-scenario leg). */
export function baselineMarginOf(scenario: ScenarioResult): string | null {
  const scenarioIds = new Set(scenario.metrics.map((m) => m.id));
  for (const proof of scenario.provenance) {
    const expr = proof.expression;
    if (expr.op === 'multiply' && expr.right.op === 'literal' && expr.right.value === '100'
      && expr.left.op === 'subtract') {
      const left = expr.left.left.op === 'metric' ? expr.left.left.metricId : null;
      const right = expr.left.right.op === 'metric' ? expr.left.right.metricId : null;
      if (left !== null && scenarioIds.has(left) && right !== null && !scenarioIds.has(right)) {
        return right;
      }
    }
  }
  return null;
}

function scenarioChart(
  snapshot: AnalysisSnapshot,
  scenario: ScenarioResult,
): ChartSpec | null {
  const scenarioMargin = scenario.metrics.find((m) => m.id === 'scenario-margin');
  const baselineId = baselineMarginOf(scenario);
  const baselineMargin = baselineId !== null
    ? snapshot.metrics.find((m) => m.id === baselineId)
    : undefined;
  if (scenarioMargin?.value === null || scenarioMargin?.value === undefined
    || baselineMargin?.value === null || baselineMargin?.value === undefined) {
    return null;
  }
  const baselineValue = baselineMargin.value as string;
  const scenarioValue = scenarioMargin.value as string;
  return {
    id: 'chart-scenario',
    kind: 'scenario-bars',
    titleKey: 'chart.scenario.title',
    summaryKey: 'chart.scenario.summary',
    unit: { kind: 'ratio', label: 'fraction', currency: null },
    series: [{ id: 'margin', labelKey: 'metric.margin', semantic: 'scenario' }],
    points: [
      {
        key: 'baseline',
        labelKey: 'common.baseline',
        values: { margin: normalizeDecimalString(baselineValue) },
        metricIds: [baselineMargin.id],
      },
      {
        key: 'scenario',
        labelKey: 'common.scenario',
        values: { margin: normalizeDecimalString(scenarioValue) },
        metricIds: ['scenario-margin'],
      },
    ],
    domain: { min: '0', max: domainCeil([baselineValue, scenarioValue]) },
    chronology: 'not-temporal',
    scope: { ...snapshot.scope },
    provenanceIds: [baselineMargin.provenanceId, scenarioMargin.provenanceId],
  };
}

/**
 * Smallest two-significant-figure bound at or above `max × 1.1`.
 * Local mirror of the analysis bound rule (packages cannot share
 * implementations across boundaries); see `domainMax` for rationale.
 */
function domainCeil(values: readonly string[]): string {
  let max = '0';
  for (const v of values) {
    const abs = v.startsWith('-') ? v.slice(1) : v;
    if (isDecimal(abs) && compareDecimal(abs, max) > 0) max = abs;
  }
  const scaled = multiplyDecimal(max, '1.1');
  if (compareDecimal(scaled, '0') === 0) return '10';
  const dot = scaled.indexOf('.');
  const intDigits = (dot === -1 ? scaled : scaled.slice(0, dot)).replace(/^0+/, '');
  const fracDigits = dot === -1 ? '' : scaled.slice(dot + 1);
  const leadingFracZeros = intDigits.length > 0 ? 0 : (fracDigits.match(/^0*/) as RegExpMatchArray)[0].length;
  const k = intDigits.length > 0 ? intDigits.length - 1 : -(leadingFracZeros + 1);
  const sig = `${intDigits}${fracDigits}`.replace(/^0+/, '');
  let t = Number(sig.slice(0, 2).padEnd(2, '0'));
  let order = k - 1;
  const render = (digits: number, power: number): string => {
    const d = String(digits);
    if (power >= 0) return `${d}${'0'.repeat(power)}`;
    const right = -power;
    if (d.length > right) return `${d.slice(0, d.length - right)}.${d.slice(d.length - right)}`;
    return `0.${'0'.repeat(right - d.length)}${d}`;
  };
  let candidate = render(t, order);
  if (compareDecimal(candidate, scaled) < 0) {
    t += 1;
    if (t === 100) {
      t = 10;
      order += 1;
    }
    candidate = render(t, order);
  }
  return normalizeDecimalString(candidate);
}

function scopeLabel(snapshot: AnalysisSnapshot, locale: Locale, numbering: 'latn' | 'arab'): string {
  const period = periodLabel(snapshot.scope.periodStart, snapshot.scope.periodEnd, locale, numbering);
  const regions = snapshot.scope.regions.length > 0 ? snapshot.scope.regions.join(', ') : null;
  return regions === null ? period : `${regions} / ${period}`;
}

export function buildExportModel(
  snapshot: AnalysisSnapshot,
  table: NormalizedTable,
  scenario: ScenarioResult | null,
  locale: Locale,
  numberingSystem: 'latn' | 'arab',
  createdAt: string,
): ExportModel {
  if (table.id !== snapshot.tableId) {
    throw new ExportModelError('stale-snapshot', 'table id does not match the snapshot tableId');
  }
  if (table.normalizationRevision !== snapshot.normalizationRevision) {
    throw new ExportModelError('stale-snapshot', 'table revision does not match the snapshot revision');
  }
  if (table.sourceRef.sourceHash !== snapshot.sourceHash) {
    throw new ExportModelError('stale-snapshot', 'table source hash does not match the snapshot');
  }
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new ExportModelError('invalid-created-at', 'createdAt must be a parseable date-time string');
  }
  if (scenario !== null) {
    if (scenario.baselineAnalysisId !== snapshot.id) {
      throw new ExportModelError('scenario-mismatch', 'scenario baseline does not match the snapshot id');
    }
    if (!deepEqual(scenario.scope, snapshot.scope)) {
      throw new ExportModelError('scenario-mismatch', 'scenario scope does not match the snapshot scope');
    }
  }

  const isSample = isSampleModel(snapshot, scenario);
  const mergedMetrics = [...snapshot.metrics, ...(scenario?.metrics ?? [])];
  const metricById = new Map(mergedMetrics.map((m) => [m.id, m] as const));
  const findingById = new Map(snapshot.findings.map((f) => [f.id, f] as const));

  const chart = scenario !== null && scenario.status === 'defined'
    ? scenarioChart(snapshot, scenario)
    : null;
  const charts = chart === null ? [...snapshot.charts] : [...snapshot.charts, chart];

  const firstFinding = snapshot.findings[0];
  const qualityFinding = snapshot.findings.find((f) => f.kind === 'quality');
  const leadFinding = snapshot.findings.find((f) => f.kind !== 'quality' && f.kind !== 'descriptive')
    ?? firstFinding;

  const baselineMarginId = scenario !== null ? baselineMarginOf(scenario) : null;
  const scenarioMetricIds = scenario !== null && scenario.status === 'defined'
    ? [
      ...(baselineMarginId !== null && metricById.has(baselineMarginId) ? [baselineMarginId] : []),
      ...scenario.metrics.filter((m) => m.id === 'scenario-margin' || m.id === 'scenario-contribution').map((m) => m.id),
    ]
    : [];

  const scopeText = scopeLabel(snapshot, locale, numberingSystem);
  const recordsNote = `records:${snapshot.qualitySummary.retainedRows}/${snapshot.qualitySummary.rawRows}`;
  // A scenario the user never committed (or one the engine could not
  // define) has nothing to say on a slide — the page is omitted rather
  // than shipped as a designed empty state.
  const committedScenario = scenario !== null && scenario.status === 'defined' ? scenario : null;

  const slideDefs: Array<{
    kind: SlideModel['kind'];
    metricIds: string[];
    findingIds: string[];
    chartIds: string[];
    notes: string[];
  }> = [
    {
      kind: 'summary',
      metricIds: [],
      findingIds: leadFinding !== undefined ? [leadFinding.id] : [],
      chartIds: [],
      notes: [`scope:${scopeText}`, recordsNote, isSample ? 'example analysis' : 'user upload'],
    },
    {
      kind: 'kpis',
      metricIds: isSample
        ? ['june-revenue', 'june-operating-cost', 'june-contribution', 'june-margin']
        : mergedMetrics.filter((m) => m.status === 'defined' && m.unit.kind !== 'ratio').slice(0, 4).map((m) => m.id),
      findingIds: [],
      chartIds: [],
      notes: [`scope:${scopeText}`],
    },
    {
      kind: 'finding',
      metricIds: leadFinding !== undefined ? [...leadFinding.metricIds] : [],
      findingIds: leadFinding !== undefined ? [leadFinding.id] : [],
      chartIds: leadFinding?.chartId != null ? [leadFinding.chartId] : [],
      notes: leadFinding !== undefined
        ? [`finding:${leadFinding.id}`, `rule:${leadFinding.ruleId}`]
        : ['no eligible findings'],
    },
    ...(committedScenario !== null
      ? [{
        kind: 'scenario' as const,
        metricIds: isSample ? ['june-margin', 'scenario-margin', 'scenario-contribution'] : scenarioMetricIds,
        findingIds: [] as string[],
        chartIds: chart !== null ? [chart.id] : [],
        notes: [`scenario:${committedScenario.costChange}`, `baseline:${committedScenario.baselineAnalysisId}`],
      }]
      : []),
    {
      kind: 'quality',
      // The trio the deck draws is the slide's own metric set, so every
      // preview surface that renders slide.metricIds shows the same
      // counts the native page carries.
      metricIds: ['quality-duplicate', 'quality-category', 'quality-missing'],
      findingIds: qualityFinding !== undefined ? [qualityFinding.id] : [],
      chartIds: [],
      notes: [
        ...(qualityFinding !== undefined ? [`finding:${qualityFinding.id}`] : []),
        `issues:${snapshot.qualitySummary.issueCount}`,
        `resolved:${snapshot.qualitySummary.resolved}`,
        `unresolved:${snapshot.qualitySummary.unresolved}`,
      ],
    },
    {
      kind: 'methodology',
      metricIds: [],
      findingIds: [],
      chartIds: [],
      notes: [
        `source:${table.sourceRef.workbookName}#${table.sourceRef.sheetName}`,
        `hash:${table.sourceRef.sourceHash.slice(0, 12)}`,
        `revision:${table.normalizationRevision.slice(0, 12)}`,
        'no forecast; no causal claim',
      ],
    },
  ];

  const slides: SlideModel[] = slideDefs.map((def, index) => {
    const copy = slideCopy(def.kind, locale, numberingSystem, snapshot, isSample);
    return {
      id: `slide-${index + 1}`,
      kind: def.kind,
      title: copy.title,
      subtitle: copy.subtitle,
      metricIds: def.metricIds.filter((id) => metricOrFinding(id)),
      findingIds: def.findingIds.filter((id) => findingById.has(id)),
      chartIds: def.chartIds.filter((id) => charts.some((c) => c.id === id)),
      notes: def.notes,
    };
  });

  function metricOrFinding(id: string): boolean {
    return metricById.has(id);
  }

  checkBudgets(slides);

  const sheetIds: SheetModel['id'][] = ['summary', 'clean', 'quality', 'kpis', 'methodology'];
  const sheets: SheetModel[] = sheetIds.map((id, index) => ({
    id,
    name: (SHEET_NAMES[locale][index] as string),
    direction: locale === 'ar' ? 'rtl' : 'ltr',
  }));

  const exportId = scenario !== null && scenario.status === 'defined'
    ? `export-${snapshot.id}-${locale}-cost${scenario.costChange.replace('-', 'm').replace('.', '')}`
    : `export-${snapshot.id}-${locale}-baseline`;

  return {
    schemaVersion: '1.0.0',
    exportId,
    analysisId: snapshot.id,
    sourceHash: snapshot.sourceHash,
    locale,
    numberingSystem,
    createdAt,
    templateVersion: TEMPLATE_VERSION,
    scope: { ...snapshot.scope },
    table,
    metrics: [...snapshot.metrics],
    findings: [...snapshot.findings],
    charts,
    provenance: [...snapshot.provenance],
    qualitySummary: { ...snapshot.qualitySummary },
    scenario,
    slides,
    sheets,
  };
}

export function numericParity(model: ExportModel): string[] {
  const problems: string[] = [];
  const metricById = new Map(model.metrics.map((m) => [m.id, m] as const));
  const scenarioMetrics = new Map((model.scenario?.metrics ?? []).map((m) => [m.id, m] as const));
  const lookup = (id: string): Metric | undefined => metricById.get(id) ?? scenarioMetrics.get(id);
  for (const chart of model.charts) {
    for (const point of chart.points) {
      // Values pair positionally with metric ids (actual→revenue, target→target).
      const entries = Object.entries(point.values);
      entries.forEach(([series, value], index) => {
        if (value === null) return;
        const metricId = point.metricIds[index];
        const metric = metricId !== undefined ? lookup(metricId) : undefined;
        if (metric?.value === null || metric?.value === undefined) {
          problems.push(`chart ${chart.id} point ${point.key} series ${series} has no valued metric`);
        } else if (compareDecimal(value, metric.value as string) !== 0) {
          problems.push(`chart ${chart.id} point ${point.key} series ${series} value ${value} ≠ metric ${metricId} ${metric.value}`);
        }
      });
    }
  }
  return problems;
}
