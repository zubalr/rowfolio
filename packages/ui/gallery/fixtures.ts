/**
 * Gallery fixtures — display strings and rows for the story matrix.
 *
 * Localized copy is quoted verbatim from contracts/locales/{en,ar}.json v1.0.0
 * (the product catalog belongs to @rowfolio/i18n, in packages/i18n). Numeric
 * display strings are the formatted truths of the fixed sample
 * (fixtures/analysis-snapshot.example.json): 881,000 vs 1,000,000 → −11.9%,
 * downtime 1,194→1,565 (+31.1%), quality 29 issues (24 resolved/5 unresolved),
 * June revenue 6,000,000 / operating cost 4,500,000, margin 25%→19% at +8%.
 * The gallery formats nothing itself — strings below are already display
 * strings, exactly what primitives receive from the i18n layer.
 */
import type { DataTableColumn, DataTableRow, StatusStage, MetricDelta } from "../src/index.ts";

export type GalleryLocale = "en" | "ar";

export const strings = {
  en: {
    eyebrow: "Component gallery",
    pageTitle: "Art-directed primitives",
    intro:
      "Paper, ink and cobalt primitives with a dark evidence surface — direction-aware in English and Arabic.",
    actions: "Actions",
    fields: "Fields",
    status: "Status",
    metrics: "Unit-aware metrics",
    table: "Source rows",
    dialog: "Dialog",
    openPanel: "Open evidence dialog",
    openCenter: "Open centered dialog",
    close: "Close",
    back: "Back",
    showWhy: "View calculation",
    cancel: "Cancel",
    save: "Save PowerPoint briefing",
    upload: "Use your spreadsheet",
    moreRows: "Show more rows",
    costField: "Operating cost change",
    costHelp: "Applies the factor after aggregation; baseline stays fixed.",
    costError: "Enter a value between −20% and +30% in steps of 0.1%.",
    processing: "Processing locally",
    ready: "Analysis ready.",
    stageRead: "Read bytes",
    stageParse: "Parse selected sheet",
    stageProfile: "Profile columns",
    stageCalc: "Calculate",
    stageReady: "Ready",
    invalidFile: "This file could not be read safely.",
    retryBody: "Keep the current results and choose a different file.",
    retry: "Try again",
    noFindings: "No strong findings met the stated rules.",
    revenue: "Revenue",
    target: "Revenue target",
    contribution: "Operating contribution",
    margin: "Contribution margin",
    downtime: "Downtime",
    undefinedReason: "Incomplete period: comparison unavailable",
    evidenceTitle: "The numbers, not just the claim.",
    evidenceDesc:
      "Exact operands, source rows and approved changes behind the selected finding.",
    calcLabel: "Calculation",
    inputsLabel: "Contributing values",
    sourceRowsLabel: "Exact source rows",
    hashLabel: "Source file fingerprint",
    hashNote: "Identifies file bytes; does not authenticate business data.",
    scenarioNote: "This is a hypothetical scenario, not a forecast.",
    period: "June 2026",
    region: "North",
    kpiLabel: "June key metrics",
    tableCaption: "Contributing source rows — North, June 2026",
    scrollRegion: "Source rows table",
    siteCol: "Site",
    revenueCol: "Revenue",
    ordersCol: "Orders",
    downtimeCol: "Downtime (min)",
    skip: "Skip to main content",
    deltaUp: "increase",
    deltaDown: "decrease",
  },
  ar: {
    eyebrow: "معرض المكوّنات",
    pageTitle: "مكوّنات موجّهة فنيًا",
    intro:
      "مكوّنات على خلفية ورقية بحبر وأزرق كوبالت مع سطح أدلة داكن — تدعم الاتجاهين في الإنجليزية والعربية.",
    actions: "الإجراءات",
    fields: "الحقول",
    status: "الحالة",
    metrics: "المؤشرات الحسّاسة للوحدات",
    table: "صفوف المصدر",
    dialog: "مربع الحوار",
    openPanel: "افتح نافذة الأدلة",
    openCenter: "افتح حوارًا مركزيًا",
    close: "إغلاق",
    back: "رجوع",
    showWhy: "كيف حُسبت هذه النتيجة؟",
    cancel: "إلغاء",
    save: "حفظ عرض PowerPoint",
    upload: "استخدم جدول بياناتك",
    moreRows: "عرض المزيد من الصفوف",
    costField: "تغيير تكاليف التشغيل",
    costHelp: "يُطبَّق المعامل بعد التجميع؛ يبقى خط الأساس ثابتًا.",
    costError: "أدخل قيمة بين −٢٠٪ و+٣٠٪ بخطوات ٠٫١٪.",
    processing: "جارٍ المعالجة محليًا",
    ready: "التحليل جاهز.",
    stageRead: "قراءة البايتات",
    stageParse: "تحليل الورقة المحددة",
    stageProfile: "تنميط الأعمدة",
    stageCalc: "الحساب",
    stageReady: "جاهز",
    invalidFile: "تعذّرت قراءة هذا الملف بأمان.",
    retryBody: "احتفظ بالنتائج الحالية واختر ملفًا مختلفًا.",
    retry: "حاول مجددًا",
    noFindings: "لم تستوفِ أي نتيجة قوية القواعد المحددة.",
    revenue: "الإيرادات",
    target: "الإيرادات المستهدفة",
    contribution: "المساهمة التشغيلية",
    margin: "هامش المساهمة التشغيلية",
    downtime: "وقت التوقف",
    undefinedReason: "فترة غير مكتملة: المقارنة غير متاحة",
    evidenceTitle: "الأرقام وراء النتيجة.",
    evidenceDesc: "القيم المستخدمة وصفوف المصدر والتغييرات المعتمدة وراء النتيجة المحددة.",
    calcLabel: "طريقة الحساب",
    inputsLabel: "القيم المستخدمة",
    sourceRowsLabel: "صفوف المصدر الفعلية",
    hashLabel: "بصمة ملف المصدر",
    hashNote: "تعرّف محتوى الملف، ولا تثبت صحة بياناته التجارية.",
    scenarioNote: "هذا سيناريو افتراضي، وليس توقعًا.",
    period: "يونيو ٢٠٢٦",
    region: "الشمال",
    kpiLabel: "مؤشرات يونيو",
    tableCaption: "صفوف المصدر المستخدمة — الشمال، يونيو ٢٠٢٦",
    scrollRegion: "جدول صفوف المصدر",
    siteCol: "الموقع",
    revenueCol: "الإيرادات",
    ordersCol: "الطلبات",
    downtimeCol: "وقت التوقف (دقيقة)",
    skip: "تخطَّ إلى المحتوى الرئيسي",
    deltaUp: "زيادة",
    deltaDown: "انخفاض",
  },
} as const;

export const stages = (s: (typeof strings)[GalleryLocale]): StatusStage[] => [
  { id: "read", label: s.stageRead },
  { id: "parse", label: s.stageParse },
  { id: "profile", label: s.stageProfile },
  { id: "calculate", label: s.stageCalc },
  { id: "ready", label: s.stageReady },
];

export interface GalleryMetric {
  id: string;
  label: string;
  /** Pre-formatted display value (Latin or Eastern-Arabic digits). */
  value: string;
  /** Contract unit label when the metric carries one. */
  unitLabel?: string;
  delta?: MetricDelta;
}

/** Sample truth metrics, pre-formatted (en-US / ar-QA-u-nu-arab). */
export const metrics: Record<GalleryLocale, GalleryMetric[]> = {
  en: [
    { id: "revenue", label: "Revenue", value: "881,000", unitLabel: "USD" },
    { id: "target", label: "Revenue target", value: "1,000,000", unitLabel: "USD" },
    {
      id: "contribution",
      label: "Operating contribution",
      value: "1,500,000",
      unitLabel: "USD",
      delta: { text: "+8%", direction: "up", sentiment: "neutral" },
    },
    {
      id: "margin",
      label: "Contribution margin",
      value: "19%",
      delta: { text: "−6 pp", direction: "down", sentiment: "negative" },
    },
    {
      id: "downtime",
      label: "Downtime",
      value: "1,565",
      unitLabel: "min",
      delta: { text: "+31.1%", direction: "up", sentiment: "attention" },
    },
  ],
  ar: [
    { id: "revenue", label: "الإيرادات", value: "٨٨١٬٠٠٠", unitLabel: "USD" },
    { id: "target", label: "الإيرادات المستهدفة", value: "١٬٠٠٠٬٠٠٠", unitLabel: "USD" },
    {
      id: "contribution",
      label: "المساهمة التشغيلية",
      value: "١٬٥٠٠٬٠٠٠",
      unitLabel: "USD",
      delta: { text: "+٨٪", direction: "up", sentiment: "neutral" },
    },
    {
      id: "margin",
      label: "هامش المساهمة التشغيلية",
      value: "١٩٪",
      delta: { text: "−6 pp", direction: "down", sentiment: "negative" },
    },
    {
      id: "downtime",
      label: "وقت التوقف",
      value: "١٬٥٦٥",
      unitLabel: "min",
      delta: { text: "+٣١٫١٪", direction: "up", sentiment: "attention" },
    },
  ],
};

export function tableColumns(s: (typeof strings)[GalleryLocale]): DataTableColumn[] {
  return [
    { id: "site", label: s.siteCol },
    { id: "revenue", label: s.revenueCol, align: "end", mono: true },
    { id: "orders", label: s.ordersCol, align: "end", mono: true },
    { id: "downtime", label: s.downtimeCol, align: "end", mono: true },
  ];
}

/** Twelve sample rows (of the real 100-row North-June selection). */
export function tableRows(): DataTableRow[] {
  const rows: DataTableRow[] = [];
  const sites = ["N-01", "N-02", "N-03", "N-04", "N-05", "N-06", "N-07", "N-08"];
  for (let i = 0; i < 60; i += 1) {
    rows.push({
      id: `r-${i}`,
      sourceRow: 1802 + i,
      values: {
        site: sites[i % sites.length]!,
        revenue: `${(8200 + (i % 9) * 310).toLocaleString("en-US")}`,
        orders: `${98 + (i % 12)}`,
        downtime: `${10 + (i % 7)}`,
      },
    });
  }
  return rows;
}
