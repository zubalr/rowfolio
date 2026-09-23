# tests/unit/i18n/generated

Mechanical English/Arabic catalog checks generated from the frozen
translation-key manifest (`packages/contracts/source/translation-keys.json`).

- `manifest-expectations.gen.ts` — generated fixture (key inventory, typed
  placeholder sets, plural groups, manifest SHA-256). Regenerate with:
  `node tooling/test/corpus/i18n/generate-expectations.ts`
- `manifest.test.ts` — drift guard and manifest-structure rules (all six
  Arabic plural categories, count placeholders, identifier syntax).
- `catalogs.test.ts` — catalog parity (keys, placeholders, plurals) plus
  mutation checks proving a missing key, a mismatched placeholder and a
  dropped plural form are each detected. Until locale catalogs land on this
  checkout, these tests report as explicitly pending with a stated reason;
  catalog translation decisions remain with the catalog owners.

The checking logic lives in `tooling/test/corpus/i18n/check-catalog.ts` and
can also be run directly as a CLI.
