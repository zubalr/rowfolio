/**
 * Translation key manifest — the contract-level list of message keys and
 * their typed placeholder sets (source/translation-keys.json). Locale
 * catalogs themselves belong to packages/i18n; this manifest is the
 * key inventory validators check `*Key` fields against.
 */
import keyManifestJson from '../source/translation-keys.json';

export const TRANSLATION_KEY_MANIFEST = keyManifestJson as unknown as {
  readonly schemaVersion: string;
  readonly keys: Readonly<Record<string, readonly string[]>>;
};

const KEY_SET: ReadonlySet<string> = new Set(Object.keys(TRANSLATION_KEY_MANIFEST.keys));

/** True when `key` is a declared translation key in the contract manifest. */
export function isTranslationKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_SET.has(key);
}

export function translationKeys(): readonly string[] {
  return Object.keys(TRANSLATION_KEY_MANIFEST.keys);
}
