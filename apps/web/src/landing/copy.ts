/**
 * Landing copy — the redesign layer keeps its strings in a locale-keyed
 * module local to the landing surface. The shared i18n catalogs are
 * contract-pinned (byte-identical hashes + a key manifest), so copy that
 * exists only for the landing narrative lives here instead of mutating
 * the contract catalogs. Parity between locales is asserted in tests.
 */
import type { Locale } from "@rowfolio/i18n";

type CopyKey =
  | "action.openWorkspace"
  | "action.skipGuide"
  | "common.region"
  | "common.scopeValue"
  | "demo.band.title"
  | "demo.step.assume.action"
  | "demo.step.assume.body"
  | "demo.step.assume.title"
  | "demo.step.brief.action"
  | "demo.step.brief.body"
  | "demo.step.brief.title"
  | "demo.step.inspect.action"
  | "demo.step.inspect.body"
  | "demo.step.inspect.title"
  | "demo.step.spot.action"
  | "demo.step.spot.body"
  | "demo.step.spot.title"
  | "evidence.scope"
  | "export.deckSlides"
  | "export.realDownloads"
  | "export.slide.1"
  | "export.slide.2"
  | "export.slide.3"
  | "export.slide.4"
  | "export.slide.5"
  | "export.slide.6"
  | "export.workbookSummary"
  | "hero.body"
  | "hero.title"
  | "landing.chart.summary"
  | "landing.chart.title"
  | "landing.close.body"
  | "landing.close.title"
  | "landing.specimen.note"
  | "scenario.assumed"
  | "scenario.contributionLabel"
  | "scenario.observed"
;

const COPY: Record<CopyKey, Record<Locale, string>> = {
  "action.openWorkspace": { en: "Open the full workspace", ar: "افتح مساحة العمل الكاملة" },
  "action.skipGuide": { en: "Skip — open the workspace", ar: "تخطَّ الجولة — افتح مساحة العمل" },
  "common.region": { en: "Region", ar: "المنطقة" },
  "common.scopeValue": { en: "{region} · {period} · {sheet}", ar: "{region} · {period} · {sheet}" },
  "demo.band.title": { en: "From the change to the briefing, in four moves.", ar: "من التغيّر إلى الإحاطة في أربع خطوات." },
  "demo.step.assume.action": { en: "Test +8% cost", ar: "جرّب ‎+٨٪‎ للتكلفة" },
  "demo.step.assume.body": { en: "Move operating costs and watch the margin respond — the observed baseline stays put while the assumption runs in amber.", ar: "حرّك تكاليف التشغيل وراقب استجابة الهامش — يبقى خط الأساس المرصود ثابتًا بينما يعمل الافتراض بلون العنبر." },
  "demo.step.assume.title": { en: "Test an assumption", ar: "اختبر افتراضًا" },
  "demo.step.brief.action": { en: "Prepare briefing", ar: "جهّز الإحاطة" },
  "demo.step.brief.body": { en: "One click assembles a six-slide deck and a workbook from the same verified snapshot.", ar: "نقرة واحدة تجمع عرضًا من ست شرائح وملف عمل من اللقطة الموثّقة نفسها." },
  "demo.step.brief.title": { en: "Take the briefing", ar: "خذ الإحاطة" },
  "demo.step.inspect.action": { en: "Open the evidence", ar: "افتح الدليل" },
  "demo.step.inspect.body": { en: "Evidence opens the exact arithmetic and the worksheet rows behind the figure — Operations rows 1802–1901.", ar: "يفتح الدليل العملية الحسابية الكاملة وصفوف ورقة العمل خلف الرقم — صفوف Operations من ١٨٠٢ إلى ١٩٠١." },
  "demo.step.inspect.title": { en: "Inspect its source", ar: "افحص مصدره" },
  "demo.step.spot.action": { en: "Show the gap", ar: "أظهر الفجوة" },
  "demo.step.spot.body": { en: "The comparison marks where the month moved: North’s June revenue sits 11.9% under target while orders rose 8.0%.", ar: "تُظهر المقارنة أين تحرّك الشهر: إيراد يونيو في الشمال أدنى من المستهدف بنسبة ١١٫٩٪ بينما ارتفعت الطلبات ٨٫٠٪." },
  "demo.step.spot.title": { en: "Spot the change", ar: "لاحظ التغيّر" },
  "evidence.scope": { en: "Scope", ar: "النطاق" },
  "export.deckSlides": { en: "Slide {n}", ar: "الشريحة {n}" },
  "export.realDownloads": { en: "Native .xlsx and .pptx are produced in the workspace — this preview names the compositions, not pixel-exact renders.", ar: "يُنتج ملفا ‎.xlsx و‎.pptx الأصليان داخل مساحة العمل — تعرض هذه المعاينة تركيبات المحتوى لا نسخًا مطابقة بالبكسل." },
  "export.slide.1": { en: "From rows to a clear briefing", ar: "من الصفوف إلى إحاطة واضحة" },
  "export.slide.2": { en: "June at a glance", ar: "يونيو في لمحة" },
  "export.slide.3": { en: "More orders. Below target.", ar: "طلبات أكثر وإيرادات دون المستهدف" },
  "export.slide.4": { en: "Test a cost assumption", ar: "اختبر افتراضاً للتكاليف" },
  "export.slide.5": { en: "What changed in the data", ar: "ما الذي تغيّر في البيانات؟" },
  "export.slide.6": { en: "Inspect before acting", ar: "تحقّق قبل اتخاذ القرار" },
  "export.workbookSummary": { en: "Workbook: executive summary, cleaned data, data quality, KPIs, methodology.", ar: "ملف العمل: ملخص تنفيذي، بيانات منقحة، جودة البيانات، مؤشرات، منهجية." },
  "hero.body": { en: "Point Rowfolio at a spreadsheet and it finds what moved, why it matters, and the rows behind every figure — processed entirely in your browser.", ar: "وجّه روفوليو إلى جدولك فيجد ما تغيّر، ولماذا يهمّ، والصفوف خلف كل رقم — وتُعالَج البيانات كلها داخل متصفحك." },
  "hero.title": { en: "Every number has a story. Show the proof.", ar: "لكل رقمٍ قصة. اعرض الدليل." },
  "landing.chart.summary": { en: "North is the visible exception: 881,000 against a 1,000,000 target; the other five regions sit within four percent of plan.", ar: "الشمال هو الاستثناء الواضح: ٨٨١٬٠٠٠ مقابل مستهدف ١٬٠٠٠٬٠٠٠، بينما تقع المناطق الخمس الأخرى ضمن أربعة بالمئة من الخطة." },
  "landing.chart.title": { en: "June revenue vs target by region", ar: "إيراد يونيو مقابل المستهدف حسب المنطقة" },
  "landing.close.body": { en: "The parser, the arithmetic and the exports run in this page. Your file is never uploaded, and clearing the tab clears the data.", ar: "المحلل والحسابات والتصديرات تعمل داخل هذه الصفحة. لا يُرفع ملفك أبدًا، ومسح التبويب يمسح البيانات." },
  "landing.close.title": { en: "Everything stays on this device.", ar: "كل شيء يبقى على هذا الجهاز." },
  "landing.specimen.note": { en: "A working slice of the product — the same parser, arithmetic and components the app uses, driven by the checked-in sample.", ar: "مقطع عملي من المنتج — المحلل والحسابات والمكوّنات الحقيقية نفسها، مدفوعة بالنموذج المضمّن." },
  "scenario.assumed": { en: "Assumed layer", ar: "طبقة الافتراض" },
  "scenario.contributionLabel": { en: "June contribution", ar: "مساهمة يونيو" },
  "scenario.observed": { en: "Observed baseline", ar: "خط الأساس المرصود" },
};

export function landingCopy(locale: Locale, key: CopyKey, params?: Record<string, string | number>): string {
  let text = COPY[key][locale];
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, String(value));
    }
  }
  return text;
}

export const LANDING_COPY_KEYS = Object.keys(COPY) as readonly CopyKey[];