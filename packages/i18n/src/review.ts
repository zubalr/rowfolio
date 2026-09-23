import type { Catalog } from "./catalog.ts";

/**
 * Arabic editorial-review record.
 *
 * The AR catalog is professionally drafted Modern Standard Arabic, but the
 * specification is explicit: native Arabic editorial review is a human release
 * gate (06_I18N_ARABIC_SPEC, 16_ACCESSIBILITY_SPEC, 27_RELEASE_CHECKLIST).
 * Nothing in this package may claim that review. This structure records the
 * honest status plus the specific phrasing a reviewer should focus on, so the
 * gate can be exercised rather than asserted.
 */

export type TerminologySeverity = "needs-native-review" | "verify-consistency";

export interface TerminologyFlag {
  /** Catalog key whose Arabic wording needs attention. */
  readonly key: string;
  /** The Arabic copy currently shipped, for reviewer context. */
  readonly arabicText: string;
  /** What a reviewer should check or decide. */
  readonly concern: string;
  /** Candidate wording, when one exists; `null` means "review as-is". */
  readonly suggestion: string | null;
  readonly severity: TerminologySeverity;
}

export interface TerminologyReviewStatus {
  /** Always `pending` until a named native reviewer signs off — never claimed otherwise. */
  readonly status: "pending-native-review";
  readonly reviewer: string | null;
  readonly note: string;
  readonly flags: readonly TerminologyFlag[];
}

const FLAGS: readonly TerminologyFlag[] = Object.freeze<TerminologyFlag[]>([
    {
      key: "metric.margin",
      arabicText: "هامش المساهمة التشغيلية",
      concern:
        "06_I18N_ARABIC_SPEC glossary prescribes «هامش الفائض التشغيلي» for contribution margin; the catalog uses «هامش المساهمة التشغيلية». Spec and catalog disagree — pick one wording and use it everywhere.",
      suggestion: "هامش الفائض التشغيلي",
      severity: "verify-consistency",
    },
    {
      key: "metric.contribution",
      arabicText: "المساهمة التشغيلية",
      concern:
        "Spec glossary prescribes «الفائض التشغيلي المحسوب» for operating contribution; catalog uses «المساهمة التشغيلية». Same drift as metric.margin — decide together.",
      suggestion: "الفائض التشغيلي المحسوب",
      severity: "verify-consistency",
    },
    {
      key: "chart.scenario.title",
      arabicText: "هامش المساهمة التشغيلية في سيناريو التكاليف",
      concern: "Carries the same margin-term drift as metric.margin.",
      suggestion: null,
      severity: "verify-consistency",
    },
    {
      key: "brand.name",
      arabicText: "روفوليو",
      concern: "Transliteration of the Rowfolio brand; confirm it is the approved Arabic rendering.",
      suggestion: null,
      severity: "needs-native-review",
    },
    {
      key: "action.pause",
      arabicText: "إيقاف الجولة مؤقتاً",
      concern: "«الجولة» renders the guided demo as a 'tour'; verify this is the intended metaphor versus «الجولة الإرشادية».",
      suggestion: null,
      severity: "needs-native-review",
    },
    {
      key: "upload.types",
      arabicText: "CSV بترميز UTF-8 أو XLSX غير مشفّر · حتى ١٠ ميبيبايت",
      concern: "«ميبيبايت» for MiB; confirm versus «ميغابايت» or a Latin «MiB» island.",
      suggestion: null,
      severity: "needs-native-review",
    },
    {
      key: "common.normalized",
      arabicText: "القيمة المنقحة",
      concern: "«منقحة» for 'normalized'; confirm versus «القيمة الموحَّدة» / «المعدَّلة».",
      suggestion: null,
      severity: "needs-native-review",
    },
    {
      key: "count.records.one",
      arabicText: "سجل واحد ({count})",
      concern:
        "Arabic singular/dual forms put the numeral in parentheses; check whether dropping {count} for one/two reads better with a native reader.",
      suggestion: null,
      severity: "needs-native-review",
    },
    {
      key: "evidence.hashNote",
      arabicText: "يؤكد الملف الذي أنتج هذا التقرير، ولا يتحقق من الأرقام التجارية.",
      concern: "«يؤكد الملف» phrasing for the fingerprint disclaimer; confirm it reads naturally to a native reader.",
      suggestion: null,
      severity: "needs-native-review",
    },
    {
      key: "scenario.result",
      arabicText: "هامش المساهمة التشغيلية: من {baseline} إلى {scenario}؛ التغيّر {delta} نقطة مئوية.",
      concern:
        "Arabic semicolon «؛» placement plus the margin-term drift; also check agreement of «نقطة مئوية» with a placeholder count.",
      suggestion: null,
      severity: "verify-consistency",
    },
]);

export const ARABIC_REVIEW: TerminologyReviewStatus = Object.freeze({
  status: "pending-native-review",
  reviewer: null,
  note: "Arabic copy is drafted MSA, not native-reviewed. The strings below carry known terminology questions a reviewer must resolve before release.",
  flags: FLAGS,
});

/**
 * Flags that reference keys missing from the AR catalog would be stale; tests
 * assert every flag's key exists so the review list can never drift silently.
 */
export function reviewFlagsFor(catalog: Catalog): readonly TerminologyFlag[] {
  return ARABIC_REVIEW.flags.filter((flag) => catalog[flag.key] !== undefined);
}
