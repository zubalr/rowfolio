import type { I18n, MessageKey } from '@rowfolio/i18n';
import type { ChartLocalization } from '@rowfolio/charts';

/** Adapt the i18n provider to the chart localization seam (structural). */
export function chartLocalization(i18n: I18n): ChartLocalization {
  return {
    direction: i18n.getState().direction,
    t: (key, params) => i18n.tSafe(key as MessageKey, params as Record<string, string>),
    formatters: {
      formatNumber: (value, options) => i18n.formatNumber(value, options),
      formatInteger: (value) => i18n.formatInteger(value),
      formatPercent: (value, options) => i18n.formatPercent(value, options),
      formatCurrency: (value, currency, options) => i18n.formatCurrency(value, currency, options),
    },
  };
}
