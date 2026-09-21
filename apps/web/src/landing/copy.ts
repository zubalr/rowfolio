/**
 * Landing copy — the redesign layer keeps its strings in a locale-keyed
 * module local to the landing surface. The shared i18n catalogs are
 * contract-pinned (byte-identical hashes + a key manifest), so copy that
 * exists only for the landing narrative lives here instead of mutating
 * the contract catalogs. Parity between locales is asserted in tests.
 */
import type { Locale } from "@rowfolio/i18n";

export type CopyKey =
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
  | "pres.artifact.chart"
  | "pres.artifact.report"
  | "pres.artifact.sheet"
  | "pres.body"
  | "pres.chapter.report"
  | "pres.chapter.result"
  | "pres.chapter.transform"
  | "pres.chapter.task"
  | "pres.chapter.check"
  | "pres.chapter.change"
  | "pres.chapter.evidence"
  | "pres.chapter.prepare"
  | "pres.chapter.deliver"
  | "pres.checkData"
  | "pres.credit"
  | "pres.downloadPptx"
  | "pres.downloadXlsx"
  | "pres.fictional"
  | "pres.hand.body"
  | "pres.hand.title"
  | "pres.next"
  | "pres.openWorkspace"
  | "pres.pause"
  | "pres.play"
  | "pres.previous"
  | "pres.progress"
  | "pres.replay"
  | "pres.report.observation"
  | "pres.report.period"
  | "pres.report.title"
  | "pres.report.verified"
  | "pres.scene.result.caption"
  | "pres.scene.transform.caption"
  | "pres.scene.transform.note"
  | "pres.scene.transform.scope"
  | "pres.scene.task.caption"
  | "pres.scene.check.caption"
  | "pres.scene.change.caption"
  | "pres.scene.evidence.caption"
  | "pres.scene.prepare.caption"
  | "pres.scene.deliver.caption"
  | "pres.task.request"
  | "pres.task.requestTitle"
  | "pres.task.period"
  | "pres.task.measures"
  | "pres.check.title"
  | "pres.check.dup"
  | "pres.check.missing"
  | "pres.check.dupTag"
  | "pres.check.missingTag"
  | "pres.evidence.title"
  | "pres.evidence.span"
  | "pres.evidence.match"
  | "pres.prepare.slideEn"
  | "pres.prepare.slideAr"
  | "pres.workbook.title"
  | "pres.title"
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
  "pres.artifact.chart": { en: "Chart", ar: "الرسم" },
  "pres.artifact.report": { en: "Report", ar: "التقرير" },
  "pres.artifact.sheet": { en: "Spreadsheet", ar: "جدول البيانات" },
  "pres.body": { en: "Check the data. Understand the results. Prepare a presentation in English or Arabic.", ar: "افحص البيانات. افهم النتائج. جهّز العرض بالإنجليزية أو العربية." },
  "pres.chapter.report": { en: "The finished report", ar: "التقرير الجاهز" },
  "pres.chapter.result": { en: "The result", ar: "النتيجة" },
  "pres.chapter.transform": { en: "From cells to chart", ar: "من الخلايا إلى الرسم" },
  "pres.checkData": { en: "Check the data", ar: "افحص البيانات" },
  "pres.credit": { en: "A project by Zubair", ar: "مشروع من إعداد زبير" },
  "pres.downloadPptx": { en: "Download PowerPoint", ar: "نزّل PowerPoint" },
  "pres.downloadXlsx": { en: "Download workbook", ar: "نزّل ملف العمل" },
  "pres.fictional": { en: "Fictional sample data", ar: "بيانات نموذجية افتراضية" },
  "pres.hand.body": { en: "Every figure below is computed by the real parser on the checked-in sample. Step through it yourself.", ar: "كل رقم أدناه يحسبه المحلل الحقيقي على النموذج المضمّن. تنقّل فيه بنفسك." },
  "pres.hand.title": { en: "The same engine, live in the page.", ar: "المحرّك نفسه يعمل داخل الصفحة." },
  "pres.next": { en: "Next", ar: "التالي" },
  "pres.openWorkspace": { en: "Open workspace", ar: "افتح مساحة العمل" },
  "pres.pause": { en: "Pause", ar: "إيقاف مؤقت" },
  "pres.play": { en: "Play", ar: "تشغيل" },
  "pres.previous": { en: "Previous", ar: "السابق" },
  "pres.progress": { en: "Chapter {n} of {total}", ar: "الفصل {n} من {total}" },
  "pres.replay": { en: "Replay presentation", ar: "أعد العرض" },
  "pres.report.observation": { en: "North June revenue sits {gap} under target while order volume rose {orders}.", ar: "إيراد يونيو في الشمال أدنى من المستهدف بنسبة {gap} بينما ارتفع حجم الطلبات بنسبة {orders}." },
  "pres.report.period": { en: "June 2026 · six regions · service operations", ar: "يونيو 2026 · ست مناطق · عمليات الخدمة" },
  "pres.report.title": { en: "June operations briefing", ar: "إحاطة عمليات يونيو" },
  "pres.report.verified": { en: "Checked against {sheet} rows {start}–{end}", ar: "تحقّق منه مقابل صفوف {start}–{end} في {sheet}" },
  "pres.scene.deliver.caption": { en: "The finished report. Downloads and the workspace are one click away.", ar: "التقرير الجاهز. التنزيلات ومساحة العمل على بُعد نقرة واحدة." },
  "pres.scene.task.caption": { en: "A manager needs the monthly operations update. The figures are in a spreadsheet. The report still needs to be prepared.", ar: "يحتاج المدير إلى تحديث العمليات الشهري. الأرقام موجودة في جدول بيانات. والتقرير ما زال بحاجة إلى إعداد." },
  "pres.scene.check.caption": { en: "Seventeen duplicate rows are excluded. Five optional survey cells stay blank; nothing is filled in.", ar: "تُستبعد سبعة عشر صفاً مكرراً. وتبقى خمس خلايا استبيان اختيارية فارغة؛ لا يُملأ شيء." },
  "pres.scene.change.caption": { en: "North June revenue sits {gap} under plan while order volume rose {orders}.", ar: "إيراد يونيو في الشمال أدنى من المستهدف بنسبة {gap} بينما ارتفع حجم الطلبات بنسبة {orders}." },
  "pres.scene.evidence.caption": { en: "Every figure traces to named rows and a calculation you can redo.", ar: "كل رقم يعود إلى صفوف مسماة وحساب يمكنك إعادته." },
  "pres.scene.prepare.caption": { en: "One report, in English and Arabic. The workbook keeps the working sheets.", ar: "تقرير واحد بالإنجليزية والعربية. وملف العمل يحفظ الأوراق." },
  "pres.chapter.task": { en: "The task", ar: "المهمة" },
  "pres.chapter.check": { en: "Check the figures", ar: "فحص الأرقام" },
  "pres.chapter.change": { en: "What changed", ar: "ما الذي تغيّر" },
  "pres.chapter.evidence": { en: "The evidence", ar: "الدليل" },
  "pres.chapter.prepare": { en: "The report in two languages", ar: "التقرير بلغتين" },
  "pres.chapter.deliver": { en: "Take it with you", ar: "خذها معك" },
  "pres.task.request": { en: "A manager needs the monthly operations update. The figures are in a spreadsheet. The report still needs to be prepared.", ar: "يحتاج المدير إلى تحديث العمليات الشهري. الأرقام موجودة في جدول بيانات. والتقرير ما زال بحاجة إلى إعداد." },
  "pres.task.requestTitle": { en: "The request", ar: "الطلب" },
  "pres.task.period": { en: "The period: June 2026, one complete scheduled month.", ar: "الفترة: يونيو 2026، شهر مجدول كامل." },
  "pres.task.measures": { en: "The measures: revenue earned against plan, order volume and downtime minutes.", ar: "المقاييس: الإيراد المتحقق مقابل المستهدف، وحجم الطلبات، ودقائق التوقف." },
  "pres.check.title": { en: "Preparation", ar: "التحضير" },
  "pres.check.dup": { en: "{n} duplicate rows excluded", ar: "{n} صفاً مكرراً استُبعد" },
  "pres.check.missing": { en: "{n} optional survey cells left blank, never filled in", ar: "{n} خلايا استبيان اختيارية تُركت فارغة، لا تُملأ أبداً" },
  "pres.check.dupTag": { en: "excluded", ar: "مستبعد" },
  "pres.check.missingTag": { en: "blank", ar: "فارغ" },
  "pres.evidence.title": { en: "Where the figure comes from", ar: "من أين جاء الرقم" },
  "pres.evidence.span": { en: "{region} · June 2026 · {sheet} rows {start}–{end}", ar: "{region} · يونيو 2026 · صفوف {start}–{end} في {sheet}" },
  "pres.evidence.match": { en: "Matches the figure on the report.", ar: "يطابق الرقم على التقرير." },
  "pres.prepare.slideEn": { en: "English", ar: "الإنجليزية" },
  "pres.prepare.slideAr": { en: "Arabic", ar: "العربية" },
  "pres.workbook.title": { en: "Workbook", ar: "ملف العمل" },
  "pres.scene.result.caption": { en: "Rows, a chart and a report page. The same data through the process.", ar: "صفوف ورسم وصفحة تقرير. البيانات نفسها عبر العملية." },
  "pres.scene.transform.caption": { en: "A manager needs the monthly operations update. The figures are in a spreadsheet. The report still needs to be prepared.", ar: "يحتاج المدير إلى تحديث العمليات الشهري. الأرقام موجودة في جدول بيانات. والتقرير ما زال بحاجة إلى إعداد." },
  "pres.scene.transform.note": { en: "Each selected cell becomes one mark.", ar: "كل خلية محددة تصبح علامة واحدة." },
  "pres.scene.transform.scope": { en: "{region} · June 2026 · revenue vs target", ar: "{region} · يونيو 2026 · الإيراد مقابل المستهدف" },
  "pres.title": { en: "Watch a spreadsheet become a finished report.", ar: "شاهد جدول بيانات يتحوّل إلى تقرير جاهز." },
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