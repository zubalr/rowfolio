/**
 * Landing i18n wiring: the static entry's `html[lang]` is the locale of
 * record; the provider also persists an explicit switch choice (validated
 * locale/digit preference only — never content) via localStorage when the
 * user picks the other language entry.
 */
import { createI18n, type I18n, type PreferenceStorage } from "@rowfolio/i18n";
import type { Locale } from "@rowfolio/contracts";

export function localeOfDocument(doc: Pick<Document, "documentElement">): Locale {
  return doc.documentElement.lang === "ar" ? "ar" : "en";
}

function safeStorage(): PreferenceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createLandingI18n(): I18n {
  return createI18n({
    locale: localeOfDocument(document),
    storage: safeStorage(),
  });
}

/**
 * Persist the visitor's explicit language choice before navigating to the
 * sibling static entry — the preference rides into the workspace session.
 */
export function persistLocaleChoice(i18n: I18n, locale: Locale): void {
  i18n.setPreference({ locale });
}
