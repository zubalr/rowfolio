import type { Locale } from "@rowfolio/contracts";
import { isolateLtr } from "./bidi.ts";
import { SUPPORTED_LOCALES } from "./catalog.ts";
import { createI18n } from "./provider.ts";

/**
 * Contract version this package implements (matches contracts/* v1.0.0).
 */
export const I18N_CONTRACT_VERSION = "1.0.0";

export interface LocaleExampleSet {
  readonly schemaVersion: "1.0.0";
  readonly contractVersion: "1.0.0";
  readonly locale: Locale;
  readonly direction: "ltr" | "rtl";
  readonly localeTag: string;
  readonly numberingSystem: "latn" | "arab";
  readonly copy: {
    readonly brandName: string;
    readonly workspaceTitle: string;
    readonly errorInternal: string;
  };
  readonly plurals: {
    readonly baseKey: "count.records";
    readonly byCount: Readonly<Record<"0" | "1" | "2" | "3" | "11" | "100", string>>;
  };
  readonly numbers: {
    readonly integer: string;
    readonly signedPercent: string;
    readonly currencyUsd: string;
    readonly exactBigDecimal: string;
  };
  readonly dates: {
    readonly day: string;
    readonly month: string;
    readonly range: string;
  };
  readonly parsing: {
    readonly groupedInput: string;
    readonly output: string;
  };
  readonly isolation: {
    readonly identifier: string;
  };
}

/**
 * Versioned, deterministic usage examples computed through the real provider —
 * the documented surface a consumer can expect per locale. Tests pin the exact
 * values so an ICU or catalog change is a deliberate, visible event.
 */
export function buildLocaleExamples(): Readonly<Record<Locale, LocaleExampleSet>> {
  const out = {} as Record<Locale, LocaleExampleSet>;
  for (const locale of SUPPORTED_LOCALES) {
    const i18n = createI18n({ locale });
    out[locale] = Object.freeze({
      schemaVersion: "1.0.0",
      contractVersion: I18N_CONTRACT_VERSION,
      locale,
      direction: i18n.direction,
      localeTag: i18n.localeTag,
      numberingSystem: i18n.numberingSystem,
      copy: Object.freeze({
        brandName: i18n.t("brand.name"),
        workspaceTitle: i18n.t("workspace.title"),
        errorInternal: i18n.t("error.INTERNAL"),
      }),
      plurals: Object.freeze({
        baseKey: "count.records",
        byCount: Object.freeze({
          "0": i18n.plural("count.records", 0),
          "1": i18n.plural("count.records", 1),
          "2": i18n.plural("count.records", 2),
          "3": i18n.plural("count.records", 3),
          "11": i18n.plural("count.records", 11),
          "100": i18n.plural("count.records", 100),
        }),
      }),
      numbers: Object.freeze({
        integer: i18n.formatNumber("881000"),
        signedPercent: i18n.formatPercent("-0.119", { maxFractionDigits: 1 }),
        currencyUsd: i18n.formatCurrency("4500000.00", "USD"),
        exactBigDecimal: i18n.formatNumber("12345678901234567890.25"),
      }),
      dates: Object.freeze({
        day: i18n.formatDate("2026-06-30"),
        month: i18n.formatMonth("2026-06"),
        range: i18n.formatDateRange("2026-05-01", "2026-06-30"),
      }),
      parsing: Object.freeze({
        groupedInput: locale === "ar" ? "١٬٢٣٤٫٥" : "1,234.5",
        output: i18n.parseDecimal(locale === "ar" ? "١٬٢٣٤٫٥" : "1,234.5"),
      }),
      isolation: Object.freeze({
        identifier: isolateLtr("f0d6d06e934b1eef"),
      }),
    });
  }
  return Object.freeze(out);
}
