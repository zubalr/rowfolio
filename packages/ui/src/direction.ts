/**
 * Direction helpers. Direction is semantic (`lang`/`dir` attributes + logical
 * CSS), never a visual-only trick — see contracts/INTERFACES.md localization
 * contract and 06_I18N_ARABIC_SPEC.md.
 */

export type LocaleCode = "en" | "ar";
export type WritingDirection = "ltr" | "rtl";

export function directionOf(locale: LocaleCode): WritingDirection {
  return locale === "ar" ? "rtl" : "ltr";
}

export function isRtl(locale: LocaleCode): boolean {
  return directionOf(locale) === "rtl";
}
