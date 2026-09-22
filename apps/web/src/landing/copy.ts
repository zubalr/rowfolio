/**
 * Landing copy — the redesign layer keeps its strings in a locale-keyed
 * module local to the landing surface. The shared i18n catalogs are
 * contract-pinned (byte-identical hashes + a key manifest), so copy that
 * exists only for the landing narrative lives here instead of mutating
 * the contract catalogs. Parity between locales is asserted in tests.
 *
 * The hero copy is verbatim from the owner's revamp brief; the Arabic is a
 * natural localization, not a literal translation. No em dashes, no hype,
 * no causation claims — the walkthrough describes what the product does,
 * on made-up example data.
 */
import type { Locale } from "@rowfolio/i18n";

export type CopyKey =
  | "beat.checks"
  | "beat.findings"
  | "beat.report"
  | "ch.chart"
  | "ch.checks"
  | "ch.report"
  | "ch.workbook"
  | "cur.usd"
  | "data.rows.kept"
  | "data.rows.read"
  | "find.actualCat"
  | "find.caption"
  | "find.orders"
  | "find.regions"
  | "find.scale"
  | "find.targetCat"
  | "flag.blank"
  | "flag.dup"
  | "guide.context.briefing"
  | "guide.context.complete"
  | "guide.context.evidence"
  | "guide.context.findings"
  | "guide.context.intro"
  | "guide.context.scenario"
  | "landing.close.body"
  | "landing.close.title"
  | "pres.body"
  | "pres.credit"
  | "pres.downloadPptx"
  | "pres.downloadXlsx"
  | "pres.explore"
  | "pres.invite.body"
  | "pres.invite.title"
  | "pres.next"
  | "pres.output.body"
  | "pres.output.slides"
  | "pres.output.title"
  | "pres.output.workbook"
  | "pres.pause"
  | "pres.play"
  | "pres.previous"
  | "pres.progress"
  | "pres.replay"
  | "pres.sampleNote"
  | "pres.title"
  | "pres.uploadHelp"
  | "pres.useOwn"
  | "pres.watch"
  | "walk.build.chartNote"
  | "walk.check.blankNote"
  | "walk.check.dupNote"
  | "walk.col.date"
  | "walk.col.plan"
  | "walk.col.region"
  | "walk.col.revenue"
  | "walk.col.survey"
  | "walk.get.langLabel"
  | "walk.sheet.monthly"
  | "walk.step.build.caption"
  | "walk.step.build.title"
  | "walk.step.check.caption"
  | "walk.step.check.title"
  | "walk.step.download.caption"
  | "walk.step.download.title"
  | "walk.step.start.caption"
  | "walk.step.start.title"
  | "walk.tag.blank"
  | "walk.tag.excluded"
  | "export.slide.1"
  | "export.slide.2"
  | "export.slide.3"
  | "export.slide.4"
  | "export.slide.5"
  | "export.slide.6"
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
  | "export.workbookSummary"
  | "hero.body"
  | "hero.title"
  | "landing.chart.summary"
  | "landing.chart.title"
  | "landing.specimen.note"
  | "lead.context"
  | "lead.cta"
  | "lead.ctaNote"
  | "lead.kicker"
  | "lead.standfirst"
  | "lead.title.accent"
  | "lead.title.post"
  | "lead.title.pre"
  | "nav.tag"
  | "plate.data"
  | "plate.findings"
  | "plate.report"
  | "pres.artifact.chart"
  | "pres.artifact.report"
  | "pres.artifact.sheet"
  | "pres.chapter.change"
  | "pres.chapter.check"
  | "pres.chapter.deliver"
  | "pres.chapter.evidence"
  | "pres.chapter.prepare"
  | "pres.chapter.report"
  | "pres.chapter.result"
  | "pres.chapter.task"
  | "pres.chapter.transform"
  | "pres.check.dup"
  | "pres.check.dupTag"
  | "pres.check.missing"
  | "pres.check.missingTag"
  | "pres.check.title"
  | "pres.checkData"
  | "pres.evidence.match"
  | "pres.evidence.span"
  | "pres.evidence.title"
  | "pres.fictional"
  | "pres.hand.body"
  | "pres.hand.title"
  | "pres.openWorkspace"
  | "pres.prepare.slideAr"
  | "pres.prepare.slideEn"
  | "pres.report.observation"
  | "pres.report.period"
  | "pres.report.title"
  | "pres.report.verified"
  | "pres.scene.change.caption"
  | "pres.scene.check.caption"
  | "pres.scene.deliver.caption"
  | "pres.scene.evidence.caption"
  | "pres.scene.prepare.caption"
  | "pres.scene.result.caption"
  | "pres.scene.task.caption"
  | "pres.scene.transform.caption"
  | "pres.scene.transform.note"
  | "pres.scene.transform.scope"
  | "pres.task.measures"
  | "pres.task.period"
  | "pres.task.request"
  | "pres.task.requestTitle"
  | "pres.workbook.title"
  | "rep.wbFormats"
  | "scenario.assumed"
  | "spread.label"
  | "scenario.contributionLabel"
  | "scenario.observed"
;

const COPY: Record<CopyKey, Record<Locale, string>> = {
  /* Broadsheet spread — new keys for the landing redesign (PR redesign/landing-demo).
     AR strings are authored here for review; nothing below is contract-pinned. */
  "beat.checks": { en: "Rows that fail a check stay marked. Nothing is silently filled.", ar: "الصفوف التي لا تجتاز الفحص تبقى معلّمة. لا يُملأ أي شيء بصمت." },
  "beat.findings": { en: "The checks turn those rows into findings: what moved, and by how much.", ar: "تحوّل الفحوصات تلك الصفوف إلى نتائج: ما الذي تحرّك وبأي قدر." },
  "ch.chart": { en: "Chart", ar: "الرسم" },
  "ch.checks": { en: "Checks", ar: "الفحص" },
  "ch.report": { en: "Report", ar: "التقرير" },
  "ch.workbook": { en: "Workbook", ar: "المصنف" },
  "beat.report": { en: "The findings land in a finished report: slides and a workbook, ready to edit.", ar: "تصل النتائج إلى تقرير جاهز: شرائح وملف عمل جاهزان للتحرير." },
  "cur.usd": { en: "USD {n}", ar: "{n} دولار" },
  "data.rows.kept": { en: "{raw} → {kept} rows", ar: "{raw} → {kept} صفًا" },
  "data.rows.read": { en: "{n} rows read", ar: "قُرئت {n} صفًا" },
  "find.actualCat": { en: "Actual", ar: "الفعلي" },
  "find.caption": { en: "{region} · June 2026 · actual vs target, USD", ar: "{region} · يونيو ٢٠٢٦ · الفعلي مقابل المستهدف بالدولار" },
  "find.orders": { en: "Orders {change}", ar: "الطلبات {change}" },
  "find.regions": { en: "{n} regions within {pct} of plan", ar: "{n} مناطق ضمن {pct} من المستهدف" },
  "find.scale": { en: "share of target", ar: "نسبة إلى المستهدف" },
  "find.targetCat": { en: "Target", ar: "المستهدف" },
  "flag.blank": { en: "Left blank, not filled", ar: "تُركت فارغة ولم تُملأ" },
  "flag.dup": { en: "Duplicate row excluded", ar: "استُبعد صف مكرر" },
  "guide.context.briefing": { en: "The briefing writes the same figures into slides and a workbook you can edit.", ar: "تكتب الإحاطة الأرقام نفسها في شرائح وملف عمل يمكنك تحريره." },
  "guide.context.complete": { en: "Nothing is uploaded; the same analysis is ready for your own file.", ar: "لا يُرفع شيء؛ والتحليل نفسه جاهز لملفك." },
  "guide.context.evidence": { en: "Every figure opens the worksheet rows it was computed from.", ar: "كل رقم يفتح صفوف ورقة العمل التي حُسب منها." },
  "guide.context.findings": { en: "Findings name what moved and by how much, before anything is exported.", ar: "تسمّي النتائج ما تحرّك وبأي قدر، قبل تصدير أي شيء." },
  "guide.context.intro": { en: "This example workbook is June 2026 operations for a fictional six-region service business.", ar: "ملف العمل النموذجي هذا هو عمليات يونيو ٢٠٢٦ لشركة خدمات افتراضية بست مناطق." },
  "guide.context.scenario": { en: "An assumption runs against the checked snapshot while the baseline stays visible.", ar: "يعمل افتراض على اللقطة الموثّقة بينما يبقى خط الأساس ظاهرًا." },
  "landing.close.body": { en: "The parser, the arithmetic and the exports run in this page. Your file is never uploaded, and clearing the tab clears the data.", ar: "المحلل والحسابات والتصديرات تعمل داخل هذه الصفحة. لا يُرفع ملفك أبدًا، ومسح التبويب يمسح البيانات." },
  "landing.close.title": { en: "Everything stays on this device.", ar: "كل شيء يبقى على هذا الجهاز." },
  "pres.body": { en: "Rowfolio checks the data, builds charts, and prepares an editable report in English or Arabic.", ar: "يفحص روفوليو البيانات، ويبني الرسوم البيانية، ويُعد تقريرًا قابلًا للتحرير بالإنجليزية أو العربية." },
  "pres.credit": { en: "A project by Zubair.", ar: "مشروع من إعداد زبير." },
  "pres.downloadPptx": { en: "Download PowerPoint", ar: "نزّل PowerPoint" },
  "pres.downloadXlsx": { en: "Download Excel", ar: "نزّل Excel" },
  "pres.explore": { en: "Explore the example", ar: "استكشف المثال" },
  "pres.invite.body": { en: "Rowfolio reads your spreadsheet in this browser and checks it before anything runs. Nothing is uploaded; clearing the tab clears the data.", ar: "يقرأ روفوليو جدولك داخل هذا المتصفح ويفحصه قبل أي خطوة. لا يُرفع شيء؛ ومسح التبويب يمسح البيانات." },
  "pres.invite.title": { en: "Try it with your own file.", ar: "جرّبه على ملفك الخاص." },
  "pres.next": { en: "Next", ar: "التالي" },
  "pres.output.body": { en: "This is what the example produces: a report you can open in PowerPoint and a workbook you can keep editing in Excel.", ar: "هذا ما ينتجه المثال: تقرير يمكن فتحه في PowerPoint وملف عمل يمكنك متابعة تحريره في Excel." },
  "pres.output.slides": { en: "{n} slides", ar: "{n} شرائح" },
  "pres.output.title": { en: "The finished output", ar: "المخرجات الجاهزة" },
  "pres.output.workbook": { en: "Workbook", ar: "ملف العمل" },
  "pres.pause": { en: "Pause", ar: "إيقاف مؤقت" },
  "pres.play": { en: "Play", ar: "تشغيل" },
  "pres.previous": { en: "Previous", ar: "السابق" },
  "pres.progress": { en: "Step {n} of {total}", ar: "الخطوة {n} من {total}" },
  "pres.replay": { en: "Replay", ar: "إعادة العرض" },
  "pres.sampleNote": { en: "The walkthrough uses made-up example data.", ar: "يستخدم الشرح التوضيحي بيانات مثال مختلقة." },
  "pres.title": { en: "Turn a spreadsheet into a presentation.", ar: "حوّل جدول بيانات إلى عرض تقديمي." },
  "pres.uploadHelp": { en: "Accepts .csv or .xlsx files with a header row. The file is read on this device only.", ar: "يقبل ملفات ‎.csv أو ‎.xlsx ذات صف عناوين. يُقرأ الملف على هذا الجهاز فقط." },
  "pres.useOwn": { en: "Use your own spreadsheet", ar: "استخدم جدولك الخاص" },
  "pres.watch": { en: "Watch how it works", ar: "شاهد كيف يعمل" },
  "walk.build.chartNote": { en: "The chart compares North's June revenue with its plan.", ar: "يقارن الرسم إيراد يونيو في الشمال مع مستهدفها." },
  "walk.check.blankNote": { en: "{n} optional survey cells stay blank, never filled in", ar: "{n} خلايا استبيان اختيارية تبقى فارغة ولا تُملأ أبدًا" },
  "walk.check.dupNote": { en: "{n} repeated rows excluded", ar: "{n} صفًا مكررًا استُبعد" },
  "walk.col.date": { en: "Date", ar: "التاريخ" },
  "walk.col.plan": { en: "Plan", ar: "المستهدف" },
  "walk.col.region": { en: "Region", ar: "المنطقة" },
  "walk.col.revenue": { en: "Revenue", ar: "الإيراد" },
  "walk.col.survey": { en: "Survey", ar: "الاستبيان" },
  "walk.get.langLabel": { en: "Report language", ar: "لغة التقرير" },
  "walk.sheet.monthly": { en: "monthly activity", ar: "نشاط شهري" },
  "walk.step.build.caption": { en: "The checked data becomes charts and a written summary.", ar: "تتحول البيانات المفحوصة إلى رسوم بيانية وملخص مكتوب." },
  "walk.step.build.title": { en: "Build the report", ar: "ابنِ التقرير" },
  "walk.step.check.caption": { en: "Repeated rows are excluded. Missing values stay visible.", ar: "تُستبعد الصفوف المكررة. وتبقى القيم المفقودة ظاهرة." },
  "walk.step.check.title": { en: "Check the data", ar: "افحص البيانات" },
  "walk.step.download.caption": { en: "Open the presentation in PowerPoint or keep the analysis in Excel.", ar: "افتح العرض في PowerPoint أو احتفظ بالتحليل في Excel." },
  "walk.step.download.title": { en: "Download and edit", ar: "نزّل وحرّر" },
  "walk.step.start.caption": { en: "This example starts with a spreadsheet of monthly activity.", ar: "يبدأ هذا المثال بجدول بيانات لنشاط شهري." },
  "walk.step.start.title": { en: "Start with a spreadsheet", ar: "ابدأ بجدول بيانات" },
  "walk.tag.blank": { en: "left blank", ar: "يُترك فارغًا" },
  "walk.tag.excluded": { en: "excluded", ar: "مستبعد" },
  /* Legacy keys retained for the specimen modules kept on disk
     (unreferenced by the revamp; pinned by adversarial scans). */
  "action.openWorkspace": { en: "Open the full workspace", ar: "افتح مساحة العمل الكاملة" },
  "action.skipGuide": { en: "Skip · open the workspace", ar: "تخطَّ الجولة · افتح مساحة العمل" },
  "common.region": { en: "Region", ar: "المنطقة" },
  "common.scopeValue": { en: "{region} · {period} · {sheet}", ar: "{region} · {period} · {sheet}" },
  "demo.band.title": { en: "From the change to the briefing, in four moves.", ar: "من التغيّر إلى الإحاطة في أربع خطوات." },
  "demo.step.assume.action": { en: "Test +8% cost", ar: "جرّب ‎+٨٪‎ للتكلفة" },
  "demo.step.assume.body": { en: "Move operating costs and watch the margin respond. The observed baseline stays put while the assumption runs in amber.", ar: "حرّك تكاليف التشغيل وراقب استجابة الهامش؛ يبقى خط الأساس المرصود ثابتًا بينما يعمل الافتراض بلون العنبر." },
  "demo.step.assume.title": { en: "Test an assumption", ar: "اختبر افتراضًا" },
  "demo.step.brief.action": { en: "Prepare briefing", ar: "جهّز الإحاطة" },
  "demo.step.brief.body": { en: "One click assembles a six-slide deck and a workbook from the same verified snapshot.", ar: "نقرة واحدة تجمع عرضًا من ست شرائح وملف عمل من اللقطة الموثّقة نفسها." },
  "demo.step.brief.title": { en: "Take the briefing", ar: "خذ الإحاطة" },
  "demo.step.inspect.action": { en: "Open the evidence", ar: "افتح الدليل" },
  "demo.step.inspect.body": { en: "Evidence opens the exact arithmetic and the worksheet rows behind the figure: Operations rows 1802-1901.", ar: "يفتح الدليل العملية الحسابية الكاملة وصفوف ورقة العمل خلف الرقم: صفوف Operations من ١٨٠٢ إلى ١٩٠١." },
  "demo.step.inspect.title": { en: "Inspect its source", ar: "افحص مصدره" },
  "demo.step.spot.action": { en: "Show the gap", ar: "أظهر الفجوة" },
  "demo.step.spot.body": { en: "The comparison marks where the month moved: North’s June revenue sits 11.9% under target while orders rose 8.0%.", ar: "تُظهر المقارنة أين تحرّك الشهر: إيراد يونيو في الشمال أدنى من المستهدف بنسبة ١١٫٩٪ بينما ارتفعت الطلبات ٨٫٠٪." },
  "demo.step.spot.title": { en: "Spot the change", ar: "لاحظ التغيّر" },
  "evidence.scope": { en: "Scope", ar: "النطاق" },
  "export.deckSlides": { en: "Slide {n}", ar: "الشريحة {n}" },
  "export.realDownloads": { en: "Native .xlsx and .pptx are produced in the workspace. This preview names the compositions, not pixel-exact renders.", ar: "يُنتج ملفا ‎.xlsx و‎.pptx الأصليان داخل مساحة العمل؛ تعرض هذه المعاينة تركيبات المحتوى لا نسخًا مطابقة بالبكسل." },
  "export.workbookSummary": { en: "Workbook: executive summary, cleaned data, data quality, KPIs, methodology.", ar: "ملف العمل: ملخص تنفيذي، بيانات منقحة، جودة البيانات، مؤشرات، منهجية." },
  "hero.body": { en: "Point Rowfolio at a spreadsheet and it finds what moved, why it matters, and the rows behind every figure, all processed entirely in your browser.", ar: "وجّه روفوليو إلى جدولك فيجد ما تغيّر، ولماذا يهمّ، والصفوف خلف كل رقم، وتُعالَج البيانات كلها داخل متصفحك." },
  "hero.title": { en: "Every number has a story. Show the proof.", ar: "لكل رقمٍ قصة. اعرض الدليل." },
  "landing.chart.summary": { en: "North is the visible exception: 881,000 against a 1,000,000 target; the other five regions sit within four percent of plan.", ar: "الشمال هو الاستثناء الواضح: ٨٨١٬٠٠٠ مقابل مستهدف ١٬٠٠٠٬٠٠٠، بينما تقع المناطق الخمس الأخرى ضمن أربعة بالمئة من الخطة." },
  "landing.chart.title": { en: "June revenue vs target by region", ar: "إيراد يونيو مقابل المستهدف حسب المنطقة" },
  "landing.specimen.note": { en: "A working slice of the product: the same parser, arithmetic and components the app uses, driven by the checked-in sample.", ar: "مقطع عملي من المنتج: المحلل والحسابات والمكوّنات الحقيقية نفسها، مدفوعة بالنموذج المضمّن." },
  "pres.artifact.chart": { en: "Chart", ar: "الرسم" },
  "pres.artifact.report": { en: "Report", ar: "التقرير" },
  "lead.context": { en: "Shown with an example workbook: June 2026 operations for a fictional six-region service business.", ar: "معروض بملف عمل نموذجي: عمليات يونيو ٢٠٢٦ لشركة خدمات افتراضية بست مناطق." },
  "lead.cta": { en: "Open Rowfolio", ar: "افتح روفوليو" },
  "lead.ctaNote": { en: "Runs locally. No upload.", ar: "يعمل محليًا. بلا رفع." },
  "lead.kicker": { en: "Rowfolio · in-browser report builder", ar: "روفوليو · منشئ تقارير داخل المتصفح" },
  "lead.standfirst": { en: "Drop in a CSV or XLSX. Rowfolio flags what needs attention, draws every figure from named source rows, and produces a report you can edit in PowerPoint and Excel. Your file never leaves this tab.", ar: "أدرج ملف CSV أو XLSX. يُعلّم روفوليو ما يحتاج إلى انتباه، ويرسم كل رقم من صفوف المصدر المسمّاة، وينتج تقريرًا يمكنك تحريره في PowerPoint وExcel. لا يغادر ملفك هذا التبويب أبدًا." },
  "lead.title.accent": { en: "checked", ar: "مفحوص" },
  "lead.title.post": { en: " and explained.", ar: " ومشروح." },
  "lead.title.pre": { en: "Your spreadsheet, ", ar: "جدولك، " },
  "nav.tag": { en: "in-browser report builder", ar: "منشئ تقارير داخل المتصفح" },
  "plate.data": { en: "Data", ar: "البيانات" },
  "plate.findings": { en: "Findings", ar: "النتائج" },
  "plate.report": { en: "Report", ar: "التقرير" },
  "pres.artifact.sheet": { en: "Spreadsheet", ar: "جدول البيانات" },
  "pres.chapter.change": { en: "What changed", ar: "ما الذي تغيّر" },
  "pres.chapter.check": { en: "Check the figures", ar: "فحص الأرقام" },
  "pres.chapter.deliver": { en: "Take it with you", ar: "خذها معك" },
  "pres.chapter.evidence": { en: "The evidence", ar: "الدليل" },
  "pres.chapter.prepare": { en: "The report in two languages", ar: "التقرير بلغتين" },
  "pres.chapter.report": { en: "The finished report", ar: "التقرير الجاهز" },
  "pres.chapter.result": { en: "The result", ar: "النتيجة" },
  "pres.chapter.task": { en: "The task", ar: "المهمة" },
  "pres.chapter.transform": { en: "From cells to chart", ar: "من الخلايا إلى الرسم" },
  "pres.check.dup": { en: "{n} duplicate rows excluded", ar: "{n} صفاً مكرراً استُبعد" },
  "pres.check.dupTag": { en: "excluded", ar: "مستبعد" },
  "pres.check.missing": { en: "{n} optional survey cells left blank, never filled in", ar: "{n} خلايا استبيان اختيارية تُركت فارغة، لا تُملأ أبداً" },
  "pres.check.missingTag": { en: "blank", ar: "فارغ" },
  "pres.check.title": { en: "Preparation", ar: "التحضير" },
  "pres.checkData": { en: "Check the data", ar: "افحص البيانات" },
  "pres.evidence.match": { en: "Matches the figure on the report.", ar: "يطابق الرقم على التقرير." },
  "pres.evidence.span": { en: "{region} · June 2026 · {sheet} rows {start}-{end}", ar: "{region} · يونيو 2026 · صفوف {start}-{end} في {sheet}" },
  "pres.evidence.title": { en: "Where the figure comes from", ar: "من أين جاء الرقم" },
  "pres.fictional": { en: "Fictional sample data", ar: "بيانات نموذجية افتراضية" },
  "pres.hand.body": { en: "Every figure below is computed by the real parser on the checked-in sample. Step through it yourself.", ar: "كل رقم أدناه يحسبه المحلل الحقيقي على النموذج المضمّن. تنقّل فيه بنفسك." },
  "pres.hand.title": { en: "The same engine, live in the page.", ar: "المحرّك نفسه يعمل داخل الصفحة." },
  "pres.openWorkspace": { en: "Open workspace", ar: "افتح مساحة العمل" },
  "pres.prepare.slideAr": { en: "Arabic", ar: "العربية" },
  "pres.prepare.slideEn": { en: "English", ar: "الإنجليزية" },
  "pres.report.observation": { en: "North June revenue sits {gap} under target while order volume rose {orders}.", ar: "إيراد يونيو في الشمال أدنى من المستهدف بنسبة {gap} بينما ارتفع حجم الطلبات بنسبة {orders}." },
  "pres.report.period": { en: "June 2026 · six regions · service operations", ar: "يونيو 2026 · ست مناطق · عمليات الخدمة" },
  "pres.report.title": { en: "June operations briefing", ar: "إحاطة عمليات يونيو" },
  "pres.report.verified": { en: "Checked against {sheet} rows {start}-{end}", ar: "تحقّق منه مقابل صفوف {start}-{end} في {sheet}" },
  "pres.scene.change.caption": { en: "North June revenue sits {gap} under plan while order volume rose {orders}.", ar: "إيراد يونيو في الشمال أدنى من المستهدف بنسبة {gap} بينما ارتفع حجم الطلبات بنسبة {orders}." },
  "pres.scene.check.caption": { en: "Seventeen duplicate rows are excluded. Five optional survey cells stay blank; nothing is filled in.", ar: "تُستبعد سبعة عشر صفاً مكرراً. وتبقى خمس خلايا استبيان اختيارية فارغة؛ لا يُملأ شيء." },
  "pres.scene.deliver.caption": { en: "The finished report. Downloads and the workspace are one click away.", ar: "التقرير الجاهز. التنزيلات ومساحة العمل على بُعد نقرة واحدة." },
  "pres.scene.evidence.caption": { en: "Every figure traces to named rows and a calculation you can redo.", ar: "كل رقم يعود إلى صفوف مسماة وحساب يمكنك إعادته." },
  "pres.scene.prepare.caption": { en: "One report, in English and Arabic. The workbook keeps the working sheets.", ar: "تقرير واحد بالإنجليزية والعربية. وملف العمل يحفظ الأوراق." },
  "pres.scene.result.caption": { en: "A spreadsheet goes in; a finished report comes out. Every figure is checked along the way.", ar: "يُدخَل جدول بيانات؛ يخرج تقرير جاهز. ويُتحقَّق من كل رقم على الطريق." },
  "pres.scene.task.caption": { en: "A manager needs the monthly operations update. The figures are in a spreadsheet. The report still needs to be prepared.", ar: "يحتاج المدير إلى تحديث العمليات الشهري. الأرقام موجودة في جدول بيانات. والتقرير ما زال بحاجة إلى إعداد." },
  "pres.scene.transform.caption": { en: "A manager needs the monthly operations update. The figures are in a spreadsheet. The report still needs to be prepared.", ar: "يحتاج المدير إلى تحديث العمليات الشهري. الأرقام موجودة في جدول بيانات. والتقرير ما زال بحاجة إلى إعداد." },
  "pres.scene.transform.note": { en: "Each selected cell becomes one mark.", ar: "كل خلية محددة تصبح علامة واحدة." },
  "pres.scene.transform.scope": { en: "{region} · June 2026 · revenue vs target", ar: "{region} · يونيو 2026 · الإيراد مقابل المستهدف" },
  "pres.task.measures": { en: "The measures: revenue earned against plan, order volume and downtime minutes.", ar: "المقاييس: الإيراد المتحقق مقابل المستهدف، وحجم الطلبات، ودقائق التوقف." },
  "pres.task.period": { en: "The period: June 2026, one complete scheduled month.", ar: "الفترة: يونيو 2026، شهر مجدول كامل." },
  "pres.task.request": { en: "A manager needs the monthly operations update. The figures are in a spreadsheet. The report still needs to be prepared.", ar: "يحتاج المدير إلى تحديث العمليات الشهري. الأرقام موجودة في جدول بيانات. والتقرير ما زال بحاجة إلى إعداد." },
  "pres.task.requestTitle": { en: "The request", ar: "الطلب" },
  "pres.workbook.title": { en: "Workbook", ar: "ملف العمل" },
  "scenario.assumed": { en: "Assumed layer", ar: "طبقة الافتراض" },
  "scenario.contributionLabel": { en: "June contribution", ar: "مساهمة يونيو" },
  "scenario.observed": { en: "Observed baseline", ar: "خط الأساس المرصود" },
  "export.slide.1": { en: "From rows to a clear briefing", ar: "من الصفوف إلى إحاطة واضحة" },
  "export.slide.2": { en: "June at a glance", ar: "يونيو في لمحة" },
  "export.slide.3": { en: "Orders rose 8.0%; revenue sits 11.9% under target.", ar: "الطلبات ارتفعت ٨٫٠٪ والإيراد أدنى من المستهدف بنسبة ١١٫٩٪." },
  "export.slide.4": { en: "Test a cost assumption", ar: "اختبر افتراضاً للتكاليف" },
  "export.slide.5": { en: "What changed in the data", ar: "ما الذي تغيّر في البيانات؟" },
  "export.slide.6": { en: "Inspect before acting", ar: "تحقّق قبل اتخاذ القرار" },
  "rep.wbFormats": { en: "Editable .pptx and .xlsx", ar: "قابل للتحرير بصيغتي ‎.pptx و‎.xlsx" },
  "spread.label": { en: "Example walkthrough: workbook, checks, chart, report", ar: "جولة في مثال: المصنف والفحص والرسم والتقرير" },
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
