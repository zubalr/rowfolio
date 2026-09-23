/**
 * Development localization fixture — a small but REAL implementation of the
 * ChartLocalization seam built on Intl. Used by unit tests and the fixture
 * gallery so component code is always exercised through the public contract,
 * never through mocks. Catalog strings are quoted verbatim from
 * `@rowfolio/i18n` (locales/en.json / ar.json, contract v1.0.0); number and
 * date formatting goes through Intl with the same resolved tags the real
 * provider uses (`en-US-u-nu-latn`, `ar-QA-u-nu-arab`).
 */
import type { Decimal, Unit } from "@rowfolio/contracts";
import type {
  ChartFormatters,
  ChartLocalization,
  ChartNumberFormatOptions,
} from "./localization.ts";

export type FixtureLocale = "en" | "ar";

const CATALOG: Record<FixtureLocale, Record<string, string>> = {
  en: {
    "a11y.chartTable": "Data table for this chart",
    "action.viewData": "View data table",
    "chart.downtime.summary":
      "North downtime moved month over month across complete scheduled periods.",
    "chart.downtime.title": "North downtime, May to June",
    "chart.north.summary":
      "North, June: actual revenue against its target.",
    "chart.north.title": "Actual revenue against target",
    "chart.quality.summary":
      "What was resolved, and what remains open.",
    "chart.quality.title": "Data quality, with the limits visible",
    "chart.scenario.summary":
      "Margin under the committed operating-cost scenario; revenue held fixed.",
    "chart.scenario.title": "Contribution margin under the cost scenario",
    "common.actual": "Actual",
    "common.allRegions": "All regions",
    "common.baseline": "Baseline",
    "common.change": "Change",
    "common.method": "Methodology",
    "common.notAvailable": "Not available",
    "common.period": "Reporting period",
    "common.scenario": "Scenario",
    "common.source": "Source",
    "common.target": "Target",
    "common.undefined": "Not defined",
    "common.units": "Units",
    "limitations.noForecast": "A mechanical sensitivity calculation, not a forecast.",
    "metric.margin": "Contribution margin",
    "metric.marginDelta": "Margin change, percentage points",
    "period.april": "April",
    "period.june": "June",
    "period.june2026": "June 2026",
    "period.march": "March",
    "period.may": "May",
    "quality.category": "Inconsistent category cells",
    "quality.duplicate": "Duplicate rows",
    "quality.issues": "Quality issues",
    "quality.missing": "Missing optional values",
    "region.Central": "Central",
    "region.Coast": "Coast",
    "region.East": "East",
    "region.North": "North",
    "region.South": "South",
    "region.West": "West",
    "workspace.scope": "Analysis scope",
  },
  ar: {
    "a11y.chartTable": "جدول بيانات هذا المخطط",
    "action.viewData": "عرض جدول البيانات",
    "chart.downtime.summary":
      "تحرّك وقت التوقف في الشمال على مدى فترتي تقارير مكتملتين.",
    "chart.downtime.title": "وقت التوقف في الشمال من مايو إلى يونيو",
    "chart.north.summary":
      "الشمال في يونيو: الإيرادات الفعلية مقابل المستهدف.",
    "chart.north.title": "الإيرادات الفعلية مقابل المستهدف",
    "chart.quality.summary":
      "صفوف وخلايا عولجت، وعناصر تبقى مفتوحة.",
    "chart.quality.title": "جودة البيانات مع توضيح الحدود",
    "chart.scenario.summary":
      "الهامش في سيناريو تكاليف التشغيل المُطبَّق؛ والإيرادات ثابتة.",
    "chart.scenario.title": "هامش المساهمة التشغيلية في سيناريو التكاليف",
    "common.actual": "الفعلي",
    "common.allRegions": "جميع المناطق",
    "common.baseline": "الحالة الأساسية",
    "common.change": "التغيّر",
    "common.method": "المنهجية",
    "common.notAvailable": "غير متاح",
    "common.period": "فترة التقرير",
    "common.scenario": "السيناريو",
    "common.source": "المصدر",
    "common.target": "المستهدف",
    "common.undefined": "غير معرّف",
    "common.units": "الوحدات",
    "limitations.noForecast": "حساب لحساسية النتائج تجاه افتراض محدد، وليس توقعاً.",
    "metric.margin": "هامش الفائض التشغيلي",
    "metric.marginDelta": "تغيّر الهامش بالنقاط المئوية",
    "period.april": "أبريل",
    "period.june": "يونيو",
    "period.june2026": "يونيو ٢٠٢٦",
    "period.march": "مارس",
    "period.may": "مايو",
    "quality.category": "خلايا فئات غير متسقة",
    "quality.duplicate": "صفوف مكررة",
    "quality.issues": "مشكلات جودة البيانات",
    "quality.missing": "قيم اختيارية مفقودة",
    "region.Central": "الوسط",
    "region.Coast": "الساحل",
    "region.East": "الشرق",
    "region.North": "الشمال",
    "region.South": "الجنوب",
    "region.West": "الغرب",
    "workspace.scope": "نطاق التحليل",
  },
};

/** Long Arabic category labels for the long-label visual case. */
export const AR_LONG_LABELS: Record<string, string> = {
  "quality.duplicate": "صفوف مكررة تم رصدها في عمود المعرّفات الموحّد",
  "quality.category": "خلايا فئات غير متسقة بين فروع التقارير الإقليمية",
  "quality.missing": "قيم اختيارية مفقودة لم تُستكمل في السجلات المصدرية",
};

function tag(locale: FixtureLocale): string {
  return locale === "ar" ? "ar-QA-u-nu-arab" : "en-US-u-nu-latn";
}

export function fixtureFormatters(locale: FixtureLocale): ChartFormatters {
  const localeTag = tag(locale);
  const nf = (options: ChartNumberFormatOptions) =>
    new Intl.NumberFormat(localeTag, {
      notation: options.compact ? "compact" : "standard",
      useGrouping: options.useGrouping ?? true,
      signDisplay: options.signDisplay ?? "auto",
      ...(options.scale !== undefined
        ? { minimumFractionDigits: options.scale, maximumFractionDigits: options.scale }
        : {}),
      ...(options.minFractionDigits !== undefined
        ? { minimumFractionDigits: options.minFractionDigits }
        : {}),
      ...(options.maxFractionDigits !== undefined
        ? { maximumFractionDigits: options.maxFractionDigits }
        : {}),
    });
  return {
    formatNumber: (value, options = {}) => nf(options).format(Number(value)),
    formatInteger: (value) =>
      new Intl.NumberFormat(localeTag, { maximumFractionDigits: 0 }).format(Number(value)),
    formatPercent: (value, options = {}) =>
      new Intl.NumberFormat(localeTag, {
        style: "percent",
        signDisplay: options.signDisplay ?? "auto",
        ...(options.maxFractionDigits !== undefined
          ? { maximumFractionDigits: options.maxFractionDigits }
          : {}),
      }).format(Number(value)),
    formatCurrency: (value, currency, options = {}) =>
      new Intl.NumberFormat(localeTag, {
        style: "currency",
        currency,
        notation: options.compact ? "compact" : "standard",
        signDisplay: options.signDisplay ?? "auto",
        ...(options.maxFractionDigits !== undefined
          ? { maximumFractionDigits: options.maxFractionDigits }
          : { maximumFractionDigits: 0 }),
      }).format(Number(value)),
  };
}

export function fixtureLocalization(locale: FixtureLocale): ChartLocalization {
  const strings = CATALOG[locale];
  const formatters = fixtureFormatters(locale);
  return {
    direction: locale === "ar" ? "rtl" : "ltr",
    t(key: string, params?: Readonly<Record<string, string>>): string {
      let text = strings[key];
      if (text === undefined) text = CATALOG.en[key] ?? key;
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replaceAll(`{${name}}`, value);
        }
      }
      return text;
    },
    formatters,
  };
}

export type { Decimal, Unit };
