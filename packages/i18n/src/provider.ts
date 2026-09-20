import type { Decimal, Locale, WorkerResponse } from "@rowfolio/contracts";
import { directionOf, isolateAuto, isolateLtr } from "./bidi.ts";
import type { Catalog, Catalogs, MessageKey } from "./catalog.ts";
import { assertLocale, defaultCatalogs, isLocale, prepareCatalogs, SUPPORTED_LOCALES } from "./catalog.ts";
import { I18nError } from "./errors.ts";
import { createFormatters } from "./format.ts";
import type { NumberingSystem } from "./format.ts";
import { interpolate } from "./interpolate.ts";
import type { PlaceholderValues, PlaceholderValue } from "./interpolate.ts";
import { parseLocalizedDecimal, parseProfileFor } from "./parse.ts";
import { resolvePluralKey, selectPluralCategory } from "./plurals.ts";

export type { Formatters, NumberFormatOptions, CurrencyFormatOptions, DateFormatOptions, ListFormatOptions } from "./format.ts";
export type { NumberingSystem } from "./format.ts";
export type { Direction } from "./bidi.ts";

/** Optional copy variant: `key.short` / `key.long` resolve before `key`. */
export type CopyVariant = "short" | "long";

/** `"default"` follows the locale's default numbering system. */
export type NumberingPreference = NumberingSystem | "default";

/** Minimal key/value storage the provider persists a preference into (e.g. `localStorage`). */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const PREFERENCE_STORAGE_KEY = "rowfolio.i18n.v1";

export type WorkerErrorCode = Extract<WorkerResponse, { kind: "error" }>["code"];

export interface LocaleState {
  readonly locale: Locale;
  readonly direction: "ltr" | "rtl";
  /** Effective numbering system in use (never "default"). */
  readonly numberingSystem: NumberingSystem;
  /** Resolved Intl tag, e.g. `ar-QA-u-nu-arab`. */
  readonly localeTag: string;
}

export interface CreateI18nOptions {
  locale?: Locale;
  numberingSystem?: NumberingPreference;
  /**
   * Optional preference store (pass `localStorage` in the app). Only the
   * validated locale/digit preference is ever written — never dataset state,
   * filenames or source content. Unavailable/throwing storage is ignored.
   */
  storage?: PreferenceStorage | null;
  storageKey?: string;
  /** Test/embedding override; defaults to the shipped v1.0.0 catalogs. */
  catalogs?: Catalogs;
}

export interface TranslateOptions {
  /** Optional `key.short` / `key.long` deck-copy variant; falls back to `key`. */
  variant?: CopyVariant;
  /**
   * Direction-isolate interpolated values: `"auto"` wraps every string param in
   * FSI…PDI (user-authored/source text), `"ltr"` in LRI…PDI (identifiers,
   * formulas, signed numerals). Default: no wrapping.
   */
  isolateParams?: false | "auto" | "ltr";
}

export interface I18n {
  readonly locale: Locale;
  readonly direction: "ltr" | "rtl";
  readonly numberingSystem: NumberingSystem;
  readonly localeTag: string;
  /** Frozen snapshot of current state; a new object on every change. */
  getState(): LocaleState;
  /** `{ lang, dir }` for the document root element. */
  documentProps(): { lang: Locale; dir: "ltr" | "rtl" };
  has(key: MessageKey): boolean;
  hasVariant(key: MessageKey, variant: CopyVariant): boolean;
  t(key: MessageKey, params?: PlaceholderValues, options?: TranslateOptions): string;
  /** Never throws: failures render the generic localized `error.INTERNAL` copy. */
  tSafe(key: MessageKey, params?: PlaceholderValues, options?: TranslateOptions): string;
  /** Localized message for a worker error code (`error.<CODE>` keys). */
  errorText(code: WorkerErrorCode): string;
  /** Counted-noun lookup: `base.<cldr-category>` with `base.other` fallback; `{count}` is auto-formatted. */
  plural(baseKey: MessageKey, count: number | Decimal, params?: PlaceholderValues): string;
  formatNumber(value: Decimal | number, options?: import("./format.ts").NumberFormatOptions): string;
  formatInteger(value: Decimal | number): string;
  /** `value` is a ratio: `"0.08"` renders as `8%` in the active digits. */
  formatPercent(value: Decimal | number, options?: import("./format.ts").NumberFormatOptions): string;
  formatCurrency(value: Decimal | number, currency: string, options?: import("./format.ts").CurrencyFormatOptions): string;
  formatDate(isoDate: string, options?: import("./format.ts").DateFormatOptions): string;
  formatMonth(period: string, options?: import("./format.ts").MonthFormatOptions): string;
  formatDateRange(startIsoDate: string, endIsoDate: string, options?: import("./format.ts").DateFormatOptions): string;
  formatList(items: readonly string[], options?: import("./format.ts").ListFormatOptions): string;
  /** Strict localized-text → canonical decimal parse under the active locale profile. */
  parseDecimal(text: string): Decimal;
  /** Native language name for a switcher label (`language.english` / `language.arabic`). */
  localeName(locale: Locale): string;
  setLocale(locale: Locale): void;
  setNumberingSystem(preference: NumberingPreference): void;
  setPreference(patch: { locale?: Locale; numberingSystem?: NumberingPreference }): void;
  subscribe(listener: (state: LocaleState) => void): () => void;
}

export function isNumberingSystem(value: unknown): value is NumberingSystem {
  return value === "latn" || value === "arab";
}

/** Contract defaults: EN renders `latn`, AR renders `arab` (Arabic-Indic) digits. */
export function defaultNumberingSystem(locale: Locale): NumberingSystem {
  return locale === "ar" ? "arab" : "latn";
}

/** Resolved Intl tag: `en-US` / `ar-QA` with the digits extension. */
export function resolveLocaleTag(locale: Locale, numberingSystem: NumberingSystem): string {
  const base = locale === "ar" ? "ar-QA" : "en-US";
  return `${base}-u-nu-${numberingSystem}`;
}

interface StoredPreference {
  v: 1;
  locale?: unknown;
  digits?: unknown;
}

function readStoredPreference(storage: PreferenceStorage | null, key: string): { locale?: Locale; digits?: NumberingPreference } {
  if (storage === null) {
    return {};
  }
  try {
    const raw = storage.getItem(key);
    if (raw === null) {
      return {};
    }
    const parsed = JSON.parse(raw) as StoredPreference;
    if (typeof parsed !== "object" || parsed === null || parsed.v !== 1) {
      return {};
    }
    const out: { locale?: Locale; digits?: NumberingPreference } = {};
    if (isLocale(parsed.locale)) {
      out.locale = parsed.locale;
    }
    if (isNumberingSystem(parsed.digits) || parsed.digits === "default") {
      out.digits = parsed.digits;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStoredPreference(storage: PreferenceStorage | null, key: string, locale: Locale, digits: NumberingPreference): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(key, JSON.stringify({ v: 1, locale, digits }));
  } catch {
    // Storage unavailable (private mode, quota, policy): preference simply does not persist.
  }
}

function isolateParams(params: PlaceholderValues, mode: "auto" | "ltr"): PlaceholderValues {
  const wrap = mode === "ltr" ? isolateLtr : isolateAuto;
  const out: Record<string, PlaceholderValue> = {};
  for (const [name, value] of Object.entries(params)) {
    out[name] = wrap(String(value));
  }
  return out;
}

function toCountNumber(count: number | Decimal): number {
  if (typeof count === "number") {
    if (!Number.isFinite(count) || count < 0 || !Number.isSafeInteger(count)) {
      throw new I18nError("invalid-count", `Invalid count: ${String(count)}`, { count: String(count) });
    }
    return count;
  }
  if (!/^\d+$/.test(count)) {
    throw new I18nError("invalid-count", `Invalid decimal count: ${count}`, { count });
  }
  const n = Number(count);
  if (!Number.isSafeInteger(n)) {
    throw new I18nError("invalid-count", `Count out of range: ${count}`, { count });
  }
  return n;
}

/**
 * Creates the framework-free locale provider. State transitions are atomic
 * snapshot swaps — `getState()` results are frozen, so a pending render keeps
 * the pre-switch object intact (the "language-switch state identity" rule).
 */
export function createI18n(options?: CreateI18nOptions): I18n {
  const catalogs = options?.catalogs !== undefined ? prepareCatalogs(options.catalogs) : defaultCatalogs();
  const storage = options?.storage ?? null;
  const storageKey = options?.storageKey ?? PREFERENCE_STORAGE_KEY;
  const stored = readStoredPreference(storage, storageKey);

  const initialLocale = assertLocale(options?.locale ?? stored.locale ?? "en");
  const initialDigits: NumberingPreference =
    options?.numberingSystem ?? stored.digits ?? "default";

  let numberingPreference: NumberingPreference = initialDigits;

  const makeState = (locale: Locale): LocaleState => {
    const ns = numberingPreference === "default" ? defaultNumberingSystem(locale) : numberingPreference;
    return Object.freeze({
      locale,
      direction: directionOf(locale),
      numberingSystem: ns,
      localeTag: resolveLocaleTag(locale, ns),
    });
  };

  let state = makeState(initialLocale);
  const listeners = new Set<(state: LocaleState) => void>();
  const formatterCache = new Map<string, ReturnType<typeof createFormatters>>();

  function formatters() {
    const existing = formatterCache.get(state.localeTag);
    if (existing !== undefined) {
      return existing;
    }
    const created = createFormatters(state.localeTag);
    formatterCache.set(state.localeTag, created);
    return created;
  }

  function catalog(): Catalog {
    return catalogs[state.locale];
  }

  function resolveKey(key: MessageKey, variant?: CopyVariant): MessageKey {
    const cat = catalog();
    if (variant !== undefined) {
      const variantKey = `${key}.${variant}`;
      if (cat[variantKey] !== undefined) {
        return variantKey;
      }
    }
    return key;
  }

  function persist() {
    writeStoredPreference(storage, storageKey, state.locale, numberingPreference);
  }

  function translate(key: MessageKey, params: PlaceholderValues | undefined, options: TranslateOptions | undefined): string {
    const cat = catalog();
    const resolved = resolveKey(key, options?.variant);
    const template = cat[resolved];
    if (template === undefined) {
      throw new I18nError("unknown-key", `Unknown message key '${key}'`, {
        key,
        locale: state.locale,
      });
    }
    const applied = options?.isolateParams ? isolateParams(params ?? {}, options.isolateParams) : params;
    return interpolate(template, applied, resolved);
  }

  function translateSafe(key: MessageKey, params: PlaceholderValues | undefined, options: TranslateOptions | undefined): string {
    try {
      return translate(key, params, options);
    } catch {
      return translate("error.INTERNAL", {}, undefined);
    }
  }

  function commit(nextLocale: Locale, nextDigits: NumberingPreference) {
    if (nextLocale === state.locale && nextDigits === numberingPreference) {
      return;
    }
    numberingPreference = nextDigits;
    state = makeState(nextLocale);
    persist();
    for (const listener of [...listeners]) {
      listener(state);
    }
  }

  return {
    get locale() {
      return state.locale;
    },
    get direction() {
      return state.direction;
    },
    get numberingSystem() {
      return state.numberingSystem;
    },
    get localeTag() {
      return state.localeTag;
    },
    getState() {
      return state;
    },
    documentProps() {
      return { lang: state.locale, dir: state.direction };
    },
    has(key: MessageKey) {
      return catalog()[key] !== undefined;
    },
    hasVariant(key: MessageKey, variant: CopyVariant) {
      return catalog()[`${key}.${variant}`] !== undefined;
    },
    t: translate,
    tSafe: translateSafe,
    errorText(code: WorkerErrorCode) {
      return translateSafe(`error.${code}`, undefined, undefined);
    },
    plural(baseKey: MessageKey, count: number | Decimal, params?: PlaceholderValues) {
      const n = toCountNumber(count);
      const category = selectPluralCategory(state.localeTag, n);
      const cat = catalog();
      const { key, template } = resolvePluralKey(cat, baseKey, category);
      const formattedCount = formatters().formatInteger(n);
      return interpolate(template, { ...params, count: formattedCount }, key);
    },
    formatNumber(value, options) {
      return formatters().formatNumber(value, options);
    },
    formatInteger(value) {
      return formatters().formatInteger(value);
    },
    formatPercent(value, options) {
      return formatters().formatPercent(value, options);
    },
    formatCurrency(value, currency, options) {
      return formatters().formatCurrency(value, currency, options);
    },
    formatDate(isoDate, options) {
      return formatters().formatDate(isoDate, options);
    },
    formatMonth(period, options) {
      return formatters().formatMonth(period, options);
    },
    formatDateRange(startIsoDate, endIsoDate, options) {
      return formatters().formatDateRange(startIsoDate, endIsoDate, options);
    },
    formatList(items, options) {
      return formatters().formatList(items, options);
    },
    parseDecimal(text: string) {
      return parseLocalizedDecimal(text, parseProfileFor(state.locale));
    },
    localeName(locale: Locale) {
      return translate(locale === "ar" ? "language.arabic" : "language.english", undefined, undefined);
    },
    setLocale(locale: Locale) {
      commit(assertLocale(locale), numberingPreference);
    },
    setNumberingSystem(preference: NumberingPreference) {
      if (preference !== "default" && !isNumberingSystem(preference)) {
        throw new I18nError("invalid-numbering-system", `Unknown numbering system: ${String(preference)}`, {
          preference: String(preference),
        });
      }
      commit(state.locale, preference);
    },
    setPreference(patch) {
      const nextLocale = patch.locale !== undefined ? assertLocale(patch.locale) : state.locale;
      const nextDigits =
        patch.numberingSystem !== undefined ? patch.numberingSystem : numberingPreference;
      if (nextDigits !== "default" && !isNumberingSystem(nextDigits)) {
        throw new I18nError("invalid-numbering-system", `Unknown numbering system: ${String(nextDigits)}`, {
          preference: String(nextDigits),
        });
      }
      commit(nextLocale, nextDigits);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export { SUPPORTED_LOCALES };
