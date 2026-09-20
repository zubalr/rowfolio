/**
 * @rowfolio/i18n — the English/Arabic language system for Rowfolio.
 *
 * Pure, framework-free package: no React, DOM, network or Node dependencies.
 * The app binds it with `createI18n({ storage: localStorage })`; export workers
 * use `createI18n({ locale, numberingSystem })` or `createFormatters(tag)`.
 */

export type { Locale } from "@rowfolio/contracts";

export { I18nError, isI18nError } from "./errors.ts";
export type { I18nErrorCode } from "./errors.ts";

export {
  PLURAL_CATEGORIES,
  SUPPORTED_LOCALES,
  assertLocale,
  defaultCatalogs,
  extractPlaceholders,
  isLocale,
  isPluralCategory,
  prepareCatalogs,
  validateCatalog,
  validateCatalogParity,
} from "./catalog.ts";
export type { Catalog, Catalogs, MessageKey, PluralCategory } from "./catalog.ts";

export { interpolate } from "./interpolate.ts";
export type { PlaceholderValue, PlaceholderValues } from "./interpolate.ts";

export { pluralVariantKey, resolvePluralKey, selectPluralCategory } from "./plurals.ts";

export {
  BIDI,
  autoIsolateProps,
  containsRtl,
  directionOf,
  isRtl,
  isolateAuto,
  isolateLtr,
  isolateRtl,
  ltrIsolateProps,
  stripBidiControls,
} from "./bidi.ts";
export type { Direction } from "./bidi.ts";

export { assertDecimal, createFormatters, toDecimal } from "./format.ts";
export type {
  CurrencyFormatOptions,
  DateFormatOptions,
  DateStyle,
  Formatters,
  ListFormatOptions,
  MonthFormatOptions,
  NumberFormatOptions,
  NumberingSystem,
} from "./format.ts";

export { normalizeNumericText, parseLocalizedDecimal, parseProfileFor } from "./parse.ts";
export type { ParseProfile } from "./parse.ts";

export {
  PREFERENCE_STORAGE_KEY,
  createI18n,
  defaultNumberingSystem,
  isNumberingSystem,
  resolveLocaleTag,
} from "./provider.ts";
export type {
  CopyVariant,
  CreateI18nOptions,
  I18n,
  LocaleState,
  NumberingPreference,
  PreferenceStorage,
  TranslateOptions,
  WorkerErrorCode,
} from "./provider.ts";

export { ARABIC_REVIEW, reviewFlagsFor } from "./review.ts";
export type { TerminologyFlag, TerminologyReviewStatus, TerminologySeverity } from "./review.ts";

export { I18N_CONTRACT_VERSION, buildLocaleExamples } from "./examples.ts";
export type { LocaleExampleSet } from "./examples.ts";
