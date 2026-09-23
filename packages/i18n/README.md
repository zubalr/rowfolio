# @rowfolio/i18n

English/Arabic language system for Rowfolio (contract v1.0.0). Pure, framework-free
TypeScript — no React, DOM, network or Node imports; app code injects storage.

## Surface

```ts
import { createI18n } from "@rowfolio/i18n";

const i18n = createI18n({ storage: localStorage }); // or { locale: "ar" } / none
i18n.documentProps();                              // { lang: "ar", dir: "rtl" }
i18n.t("finding.north.body", { gap: "−11.9%", orders: "+8%" });
i18n.t("export.title", undefined, { variant: "short" }); // key.short → key fallback
i18n.plural("count.records", 2400);                // CLDR category + {count}
i18n.formatNumber("881000.5");                     // exact digits, any length
i18n.formatPercent("-0.119", { maxFractionDigits: 1 });
i18n.formatCurrency("4500000.00", "USD");
i18n.formatDate("2026-06-30");                     // Gregorian, UTC-stable
i18n.parseDecimal("١٬٢٣٤٫٥");                      // → "1234.5" (strict profile)
i18n.subscribe((state) => render(state));
```

- `t()` throws `I18nError("unknown-key" | "missing-placeholder")`; `tSafe()`
  returns the generic localized error (`error.INTERNAL`) instead — the
  user-visible fallback never leaks internals.
- `isolateLtr` / `isolateAuto` wrap values in Unicode isolates for LTR
  identifier islands and `dir=auto` user content. `isolateParams` on `t()`
  applies this to every placeholder value.
- Locale preference (`{v:1, locale, digits}`) persists under
  `rowfolio.i18n.v1` via injected `PreferenceStorage`; absent/throwing storage
  is ignored and no source data is ever written. `digits: "default"` follows
  the locale (EN→latn, AR→arab); `"latn"` is the advanced Western-digit
  preference for Arabic.

## Copy variants

`{key}.short` / `{key}.long` are optional deck-copy variants used by the PPTX
layout's measured text budgets (`t(key, params, { variant })` falls back to the
base key). The shipped catalog holds the contract key set verbatim; new variant
keys land through the contract process (see PR change requests).

## Arabic review status

`ARABIC_REVIEW` records `pending-native-review` plus per-key terminology flags.
Native editorial review is a release gate — this package does not claim it.

## Tests

`pnpm test` (vitest) picks up `tests/unit/i18n/`. The catalogs
`src/locales/{en,ar}.json` are byte-identical to `contracts/locales/`; the
parity test pins their SHA-256.
