/**
 * Deck copy tables: human labels for metrics, findings, charts, quality,
 * scenario, coverage and evidence notes, in English and Arabic.
 *
 * Source: the planning locale reference (contracts/locales), which carries
 * the reviewed translations behind the in-repo translation-key manifest.
 * The canonical future home is the owned locale catalog (Cloud/i18n
 * lane); until it ships consumable values, the deck renders these
 * reference-derived strings so visible prose never falls back to raw
 * IDs or English scaffolding in Arabic decks. Every key here exists in
 * `translation-keys.json`; missing keys are a Cloud proposal, not a
 * local invention (see the private receipt).
 *
 * No placeholders are interpolated here: callers pass through only
 * exact model values alongside these labels.
 */
import type { Locale, Metric, Scope } from '@rowfolio/contracts';
import { periodLabel } from '@rowfolio/export-model';

const STRINGS: Record<Locale, Record<string, string>> = {
  en: {
    "metric.revenue": "Revenue",
    "metric.target_revenue": "Revenue target",
    "metric.operating_cost": "Operating cost",
    "metric.order_volume": "Order volume",
    "metric.downtime_minutes": "Downtime",
    "metric.maintenance_cost": "Maintenance cost",
    "metric.csat_score": "Satisfaction score",
    "metric.contribution": "Operating contribution",
    "metric.margin": "Contribution margin",
    "metric.marginDelta": "Margin change, percentage points",
    "metric.targetGap": "Difference from target",
    "metric.ordersChange": "Order volume change",
    "metric.downtimeChange": "Downtime change",
    "finding.north.title": "North revenue sits under target even as orders climbed",
    "finding.north.body": "North June revenue is {gap} below target, while order volume is {orders} higher than May",
    "finding.downtime.title": "North downtime moved sharply between May and June",
    "finding.downtime.body": "North downtime increased {change}, from {previous} to {current} minutes",
    "finding.quality.title": "What was cleaned, and what is still open",
    "finding.quality.body": "{duplicates} duplicate rows excluded, {categories} category cells normalized; {missing} optional scores remain missing",
    "finding.quality.body.pending": "{duplicates} duplicate rows and {categories} category cells were flagged; proposed fixes apply only after approval. Unapproved rows stay in the analysis. {missing} optional scores are left empty.",
    "chart.quality.summary.generic": "Issues found in the source; proposed fixes apply only after approval",
    "finding.descriptive.title": "A descriptive view of your table",
    "finding.descriptive.body": "Business meaning has not been confirmed. These summaries describe the selected columns only.",
    "chart.north.title": "Actual revenue against target",
    "chart.downtime.title": "North downtime, May to June",
    "chart.quality.title": "Data quality and its limits",
    "chart.scenario.title": "Contribution margin under the cost scenario",
    "common.actual": "Actual",
    "common.target": "Target",
    "common.baseline": "Baseline",
    "common.scenario": "Scenario",
    "quality.duplicate": "Duplicate rows",
    "quality.category": "Inconsistent category cells",
    "quality.missing": "Missing optional values",
    "quality.issues": "Quality issues",
    "quality.resolved": "Resolved",
    "quality.unresolved": "Unresolved",
    "quality.noImputation": "Missing values are not filled in",
    "region.North": "North",
    "region.South": "South",
    "region.East": "East",
    "region.West": "West",
    "region.Central": "Central",
    "region.Coast": "Coast",
    "period.january": "January",
    "period.february": "February",
    "period.march": "March",
    "period.april": "April",
    "period.may": "May",
    "period.june": "June",
    "period.july": "July",
    "period.august": "August",
    "period.september": "September",
    "period.october": "October",
    "period.november": "November",
    "period.december": "December",
    "common.synthetic": "Sample data",
    "common.prepared": "Example analysis",
    "common.metric": "Metric",
    "common.technicalDetails": "Technical details",
    "unit.records": "records",
    "unit.records.one": "record",
    "unit.pp": "percentage points",
    "common.allRegions": "All regions",
    "common.rows": "Source rows",
    "common.method": "Methodology",
    "common.source": "Source",
    "common.sheet": "Sheet",
    "common.change": "Change",
    "common.current": "Current period",
    "common.previous": "Previous period",
    "common.notAvailable": "Not available",
    "common.local": "Processed in your browser",
    "common.period": "Reporting period",
    "common.units": "Units",
    "common.verified": "Calculation verified",
    "scenario.question": "What if operating costs change?",
    "scenario.costChange": "Operating cost change",
    "scenario.assumption.revenueFixed": "Revenue stays fixed",
    "scenario.assumption.mechanical": "Only selected operating costs change; this is not a forecast",
    "scenario.unavailable": "Confirm compatible revenue and operating-cost columns to use this scenario",
    "scenario.zeroRevenue": "Margin is unavailable because revenue is zero or negative",
    "scenario.negativeCost": "This scenario requires nonnegative operating costs",
    "export.includesScenario": "Includes the {change} operating-cost scenario",
    "export.colophon": "Zubair Jashim, Computer Science graduate, Qatar University",
    "coverage.scheduledComplete": "Every scheduled period is complete",
    "coverage.allSource": "All selected source records",
    "limitations.noCausality": "This comparison does not establish a cause",
    "limitations.missingRetained": "Missing optional scores are not filled in",
    "limitations.contribution": "Revenue minus selected operating costs; not net profit",
    "limitations.noForecast": "A mechanical sensitivity calculation, not a forecast",
    "limitations.cache": "Formula caches may be stale and are not recalculated",
    "evidence.calculation": "Calculation",
    "evidence.inputs": "Contributing values",
    "evidence.sourceRows": "Exact source rows",
    "evidence.exclusions": "Excluded records",
    "evidence.transformations": "Approved changes",
    "evidence.hash": "Source file fingerprint",
    "empty.noFindings": "No finding passed the analysis rules",
    "empty.noData": "No usable rows were found in this table",
    "common.rawInput": "Raw input",
    "common.retained": "Retained",
    "table.metric": "Metric",
    "table.value": "Value",
    "table.unit": "Unit",
    "quality.reconciliation": "Reconciliation",
    "scenario.layer": "Editable assumption",
    "scenario.notCommitted": "No scenario is committed for this report",
  },
  ar: {
    "metric.revenue": "الإيرادات",
    "metric.target_revenue": "الإيرادات المستهدفة",
    "metric.operating_cost": "تكاليف التشغيل",
    "metric.order_volume": "حجم الطلبات",
    "metric.downtime_minutes": "وقت التوقف",
    "metric.maintenance_cost": "تكلفة الصيانة",
    "metric.csat_score": "درجة الرضا",
    "metric.contribution": "المساهمة التشغيلية",
    "metric.margin": "هامش المساهمة التشغيلية",
    "metric.marginDelta": "تغيّر الهامش بالنقاط المئوية",
    "metric.targetGap": "الفرق عن المستهدف",
    "metric.ordersChange": "التغيّر في حجم الطلبات",
    "metric.downtimeChange": "التغيّر في وقت التوقف",
    "finding.north.title": "إيرادات الشمال دون المستهدف رغم ارتفاع الطلبات",
    "finding.north.body": "إيرادات الشمال في يونيو أقل من المستهدف بنسبة {gap}، بينما يزيد حجم الطلبات بنسبة {orders} مقارنة بمايو",
    "finding.downtime.title": "تحرّك وقت التوقف في الشمال بشكل حاد بين مايو ويونيو",
    "finding.downtime.body": "زاد وقت التوقف في الشمال بنسبة {change}، من {previous} إلى {current} دقيقة",
    "finding.quality.title": "ما عُولج، وما يبقى مفتوحاً",
    "finding.quality.body": "استُبعدت الصفوف المكررة وعددها {duplicates}، ووُحّدت قيم الفئات في {categories} خلايا؛ ولا تزال {missing} قيم اختيارية مفقودة",
    "finding.quality.body.pending": "رُصدت {duplicates} صفوفاً مكررة و{categories} خلايا فئات؛ لا تُطبَّق الإصلاحات المقترحة إلا بعد الموافقة، وتبقى الصفوف غير المعتمدة ضمن التحليل. تُركت {missing} قيم اختيارية فارغة.",
    "chart.quality.summary.generic": "مشكلات مرصودة في المصدر؛ لا تُطبَّق الإصلاحات المقترحة إلا بعد الموافقة",
    "finding.descriptive.title": "وصف لبيانات جدولك",
    "finding.descriptive.body": "لم تُؤكَّد الدلالة التجارية للبيانات. تصف هذه الملخصات الأعمدة المحددة فقط.",
    "chart.north.title": "الإيرادات الفعلية مقابل المستهدف",
    "chart.downtime.title": "وقت التوقف في الشمال من مايو إلى يونيو",
    "chart.quality.title": "جودة البيانات وحدودها",
    "chart.scenario.title": "هامش المساهمة التشغيلية في سيناريو التكاليف",
    "common.actual": "الفعلي",
    "common.target": "المستهدف",
    "common.baseline": "الحالة الأساسية",
    "common.scenario": "السيناريو",
    "quality.duplicate": "صفوف مكررة",
    "quality.category": "خلايا فئات غير متسقة",
    "quality.missing": "قيم اختيارية مفقودة",
    "quality.issues": "مشكلات جودة البيانات",
    "quality.resolved": "تمت المعالجة",
    "quality.unresolved": "غير مُعالجة",
    "quality.noImputation": "لا تُستكمَل القيم المفقودة تلقائياً",
    "region.North": "الشمال",
    "region.South": "الجنوب",
    "region.East": "الشرق",
    "region.West": "الغرب",
    "region.Central": "الوسط",
    "region.Coast": "الساحل",
    "period.january": "يناير",
    "period.february": "فبراير",
    "period.march": "مارس",
    "period.april": "أبريل",
    "period.may": "مايو",
    "period.june": "يونيو",
    "period.july": "يوليو",
    "period.august": "أغسطس",
    "period.september": "سبتمبر",
    "period.october": "أكتوبر",
    "period.november": "نوفمبر",
    "period.december": "ديسمبر",
    "common.synthetic": "بيانات نموذجية",
    "common.prepared": "تحليل نموذجي",
    "common.metric": "مقياس",
    "common.technicalDetails": "تفاصيل تقنية",
    "unit.records": "سجلات",
    "unit.records.one": "سجل",
    "unit.pp": "نقاط مئوية",
    "common.allRegions": "جميع المناطق",
    "common.rows": "صفوف المصدر",
    "common.method": "المنهجية",
    "common.source": "المصدر",
    "common.sheet": "ورقة العمل",
    "common.change": "التغيّر",
    "common.current": "الفترة الحالية",
    "common.previous": "الفترة السابقة",
    "common.notAvailable": "غير متاح",
    "common.local": "تُعالَج داخل متصفحك",
    "common.period": "فترة التقرير",
    "common.units": "الوحدات",
    "common.verified": "تم التحقّق من الحساب",
    "scenario.question": "ماذا لو تغيّرت تكاليف التشغيل؟",
    "scenario.costChange": "التغيّر في تكاليف التشغيل",
    "scenario.assumption.revenueFixed": "تبقى الإيرادات ثابتة",
    "scenario.assumption.mechanical": "تتغيّر تكاليف التشغيل المحددة فقط؛ وهذا ليس توقعاً",
    "scenario.unavailable": "أكّد أعمدة الإيرادات وتكاليف التشغيل المتوافقة لاستخدام هذا السيناريو",
    "scenario.zeroRevenue": "الهامش غير متاح لأن الإيرادات صفرية أو سالبة",
    "scenario.negativeCost": "يتطلب هذا السيناريو تكاليف تشغيل غير سالبة",
    "export.includesScenario": "يتضمن سيناريو تغيّر تكاليف التشغيل بنسبة {change}",
    "export.colophon": "زبير جشيم، خريج علوم الحاسوب، جامعة قطر",
    "coverage.scheduledComplete": "اكتملت كل الفترات المجدولة",
    "coverage.allSource": "جميع سجلات المصدر المحددة",
    "limitations.noCausality": "لا تثبت هذه المقارنة وجود علاقة سببية",
    "limitations.missingRetained": "لا تُستكمَل الدرجات الاختيارية المفقودة",
    "limitations.contribution": "الإيرادات ناقص تكاليف التشغيل المحددة؛ وليست صافي الربح",
    "limitations.noForecast": "حساب لحساسية النتائج تجاه افتراض محدد، وليس توقعاً",
    "limitations.cache": "قد تكون القيم المخزنة للصيغ قديمة، ولا يُعاد حسابها",
    "evidence.calculation": "طريقة الحساب",
    "evidence.inputs": "القيم المستخدمة",
    "evidence.sourceRows": "صفوف المصدر الفعلية",
    "evidence.exclusions": "السجلات المستبعدة",
    "evidence.transformations": "التغييرات المعتمدة",
    "evidence.hash": "بصمة ملف المصدر",
    "empty.noFindings": "لم تجتز أي نتيجة قواعد التحليل",
    "empty.noData": "لم يُعثَر على صفوف قابلة للاستخدام في هذا الجدول",
    "common.rawInput": "المدخلات الخام",
    "common.retained": "المحتفظ بها",
    "table.metric": "المؤشر",
    "table.value": "القيمة",
    "table.unit": "الوحدة",
    "quality.reconciliation": "المطابقة",
    "scenario.layer": "افتراض قابل للتعديل",
    "scenario.notCommitted": "لم يُعتمد أي سيناريو لهذا التقرير",
  },
};

/** Localized label for a declared translation key. Throws on unknown keys: visible copy must never silently degrade to an ID. */
export function label(locale: Locale, key: string): string {
  const table = STRINGS[locale];
  const value = table[key];
  if (value === undefined) {
    throw new Error(`missing deck label for key ${JSON.stringify(key)} (${locale})`);
  }
  return value;
}

const PLURAL_RULES: Record<Locale, Intl.PluralRules> = {
  en: new Intl.PluralRules('en'),
  ar: new Intl.PluralRules('ar'),
};

/**
 * Localized unit label inflected for `count`: a `<key>.<CLDR category>`
 * variant wins when the table carries it (e.g. unit.records.one), else the
 * base label stands, so every count without a declared form keeps the
 * established wording.
 */
export function unitLabel(locale: Locale, key: string, count?: number): string {
  if (count !== undefined) {
    const variant = `${key}.${PLURAL_RULES[locale].select(count)}`;
    if (hasLabel(variant)) return label(locale, variant);
  }
  return label(locale, key);
}

/** True when both locales carry the key. */
export function hasLabel(key: string): boolean {
  return STRINGS.en[key] !== undefined && STRINGS.ar[key] !== undefined;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;

/**
 * Display name for a metric within a slide set: when the same label key
 * would name two cells identically (e.g. May vs June order volume), qualify
 * with the metric's period-end month. Only rendered when that period key is
 * in the copy table — otherwise the plain name stands. Shared by the deck
 * writer and the in-app preview so both name metrics identically.
 */
export function metricDisplayName(locale: Locale, metric: Metric, siblings: readonly Metric[]): string {
  const name = hasLabel(metric.labelKey) ? label(locale, metric.labelKey) : metric.id;
  const duplicates = siblings.filter((m) => m.id !== metric.id && m.labelKey === metric.labelKey);
  if (duplicates.length === 0) return name;
  const end = metric.scope.periodEnd;
  const month = end === null ? undefined : MONTHS[Number(end.slice(5, 7)) - 1];
  const key = month !== undefined ? `period.${month}` : '';
  if (key === '' || !hasLabel(key)) return name;
  return `${name} · ${label(locale, key)}`;
}

/** Human scope line — region(s) + period, localized when the region is known. */
export function scopeText(locale: Locale, scope: Scope, numberingSystem: 'latn' | 'arab'): string {
  const regions = scope.regions.map((r) => (hasLabel(`region.${r}`) ? label(locale, `region.${r}`) : r));
  const period = periodLabel(scope.periodStart, scope.periodEnd, locale, numberingSystem);
  return [...regions, period].join(' · ');
}
