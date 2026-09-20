/**
 * Workbook copy tables: human labels for the summary, KPI names,
 * coverage notes and assumption lines, in English and Arabic.
 *
 * Source: the planning locale reference behind the in-repo
 * translation-key manifest; canonical home is the owned locale
 * catalog (Cloud/i18n lane). Structural ledger headers stay in
 * stable technical English pending catalog keys (see receipt).
 */
import type { Locale } from '@rowfolio/contracts';

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
    "quality.duplicate": "Duplicate rows",
    "quality.category": "Inconsistent category cells",
    "quality.missing": "Missing optional values",
    "coverage.scheduledComplete": "Complete against the declared reporting calendar",
    "coverage.allSource": "All selected source records",
    "coverage.partial": "Incomplete period: comparison unavailable",
    "export.title": "A briefing you can take with you.",
    "export.includesScenario": "Includes the committed {change} operating-cost scenario.",
    "common.baseline": "Baseline",
    "common.source": "Source",
    "common.allRegions": "All regions",
    "common.rows": "Source rows",
    "workspace.scope": "Analysis scope",
    "workspace.records": "{raw} input records · {clean} retained",
    "evidence.title": "The numbers, not just the claim.",
    "scenario.title": "Test one assumption.",
    "scenario.assumption.revenueFixed": "Revenue stays fixed.",
    "scenario.costChange": "Operating cost change",
    "scenario.assumption.mechanical": "Only selected operating costs change; this is not a forecast.",
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
    "quality.duplicate": "صفوف مكررة",
    "quality.category": "خلايا فئات غير متسقة",
    "quality.missing": "قيم اختيارية مفقودة",
    "coverage.scheduledComplete": "مكتملة وفق تقويم التقارير المعلن",
    "coverage.allSource": "جميع سجلات المصدر المحددة",
    "coverage.partial": "فترة غير مكتملة: المقارنة غير متاحة",
    "export.title": "إحاطة يمكنك الاحتفاظ بها.",
    "export.includesScenario": "يتضمن السيناريو المعتمد لتغيّر تكاليف التشغيل بنسبة {change}.",
    "common.baseline": "الحالة الأساسية",
    "common.source": "المصدر",
    "common.allRegions": "جميع المناطق",
    "common.rows": "صفوف المصدر",
    "workspace.scope": "نطاق التحليل",
    "workspace.records": "سجلات المصدر: {raw} · السجلات المحتفظ بها: {clean}",
    "evidence.title": "الأرقام وراء النتيجة.",
    "scenario.title": "اختبر افتراضاً واحداً.",
    "scenario.assumption.revenueFixed": "تبقى الإيرادات ثابتة.",
    "scenario.costChange": "التغيّر في تكاليف التشغيل",
    "scenario.assumption.mechanical": "تتغيّر تكاليف التشغيل المحددة فقط؛ وهذا ليس توقعاً.",
  },
};

/** Localized label for a declared translation key. Throws on unknown keys. */
export function sheetLabel(locale: Locale, key: string): string {
  const value = STRINGS[locale][key];
  if (value === undefined) {
    throw new Error(`missing workbook label for key ${JSON.stringify(key)} (${locale})`);
  }
  return value;
}

/** True when both locales carry the key. */
export function hasSheetLabel(key: string): boolean {
  return STRINGS.en[key] !== undefined && STRINGS.ar[key] !== undefined;
}
