import { describe, expect, it } from "vitest";
import {
  PREFERENCE_STORAGE_KEY,
  createI18n,
  defaultNumberingSystem,
  resolveLocaleTag,
} from "../../../packages/i18n/src/index.ts";
import type { LocaleState, PreferenceStorage } from "../../../packages/i18n/src/index.ts";

function memoryStorage(initial?: Record<string, string>): PreferenceStorage & {
  data: Map<string, string>;
  getCalls: number;
  setCalls: number;
} {
  const data = new Map(Object.entries(initial ?? {}));
  const store = {
    data,
    getCalls: 0,
    setCalls: 0,
    getItem(k: string) {
      store.getCalls += 1;
      return data.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      store.setCalls += 1;
      data.set(k, v);
    },
    removeItem(k: string) {
      data.delete(k);
    },
  };
  return store;
}

describe("resolveLocaleTag / defaultNumberingSystem", () => {
  it("defaults: en→latn, ar→arab", () => {
    expect(defaultNumberingSystem("en")).toBe("latn");
    expect(defaultNumberingSystem("ar")).toBe("arab");
    expect(resolveLocaleTag("en", "latn")).toBe("en-US-u-nu-latn");
    expect(resolveLocaleTag("ar", "arab")).toBe("ar-QA-u-nu-arab");
    expect(resolveLocaleTag("ar", "latn")).toBe("ar-QA-u-nu-latn");
  });
});

describe("createI18n — state shape", () => {
  it("exposes frozen state snapshots", () => {
    const i18n = createI18n({ locale: "ar", storage: memoryStorage() });
    const s = i18n.getState();
    expect(s).toEqual({
      locale: "ar",
      direction: "rtl",
      numberingSystem: "arab",
      localeTag: "ar-QA-u-nu-arab",
    });
    expect(Object.isFrozen(s)).toBe(true);
  });

  it("documentProps gives html lang/dir", () => {
    expect(createI18n({ locale: "en" }).documentProps()).toEqual({ lang: "en", dir: "ltr" });
    expect(createI18n({ locale: "ar" }).documentProps()).toEqual({ lang: "ar", dir: "rtl" });
  });

  it("rejects unknown locales at creation", () => {
    expect(() => createI18n({ locale: "fr" as never })).toThrowError(
      expect.objectContaining({ code: "invalid-locale" }),
    );
  });
});

describe("language-switch state identity", () => {
  it("setLocale produces a NEW frozen state object; old state untouched", () => {
    const storage = memoryStorage();
    const i18n = createI18n({ locale: "en", storage });
    const before = i18n.getState();
    i18n.setLocale("ar");
    const after = i18n.getState();
    expect(before).not.toBe(after);
    expect(before.locale).toBe("en");
    expect(after.locale).toBe("ar");
    expect(after.direction).toBe("rtl");
    // numbering preference follows locale when set to "default"
    expect(after.numberingSystem).toBe("arab");
    expect(after.localeTag).toBe("ar-QA-u-nu-arab");
  });

  it("subscribers are notified on change and not on no-op", () => {
    const i18n = createI18n({ locale: "en" });
    const seen: LocaleState[] = [];
    i18n.subscribe((s) => seen.push(s));
    i18n.setLocale("ar");
    i18n.setLocale("ar"); // no-op
    i18n.setNumberingSystem("latn");
    expect(seen.map((s) => s.localeTag)).toEqual(["ar-QA-u-nu-arab", "ar-QA-u-nu-latn"]);
  });

  it("unsubscribe stops notifications", () => {
    const i18n = createI18n({ locale: "en" });
    let calls = 0;
    const off = i18n.subscribe(() => {
      calls += 1;
    });
    i18n.setLocale("ar");
    off();
    i18n.setLocale("en");
    expect(calls).toBe(1);
  });
});

describe("preference persistence — survives without source data", () => {
  it("writes only {v,locale,digits} — no source data", () => {
    const storage = memoryStorage();
    const i18n = createI18n({ locale: "en", storage });
    i18n.setLocale("ar");
    const raw = storage.data.get(PREFERENCE_STORAGE_KEY);
    expect(raw).toBe(JSON.stringify({ v: 1, locale: "ar", digits: "default" }));
  });

  it("restores a stored preference on next session", () => {
    const storage = memoryStorage();
    createI18n({ locale: "en", storage }).setLocale("ar");
    // No explicit locale → the stored preference wins.
    const restored = createI18n({ storage });
    expect(restored.getState().locale).toBe("ar");
    expect(restored.getState().direction).toBe("rtl");
    // An explicit caller locale overrides the stored one.
    expect(createI18n({ locale: "en", storage }).getState().locale).toBe("en");
  });

  it("explicit digits preference overrides locale default and persists", () => {
    const storage = memoryStorage();
    const i18n = createI18n({ locale: "ar", storage });
    i18n.setNumberingSystem("latn");
    expect(i18n.getState().localeTag).toBe("ar-QA-u-nu-latn");
    expect(i18n.formatNumber("5")).toBe("5");
    const restored = createI18n({ locale: "ar", storage });
    expect(restored.getState().numberingSystem).toBe("latn");
    expect(restored.formatNumber("1234")).toBe("1,234");
  });

  it("explicit digits preference survives a locale switch", () => {
    const storage = memoryStorage();
    const i18n = createI18n({ locale: "en", storage });
    i18n.setNumberingSystem("arab");
    i18n.setLocale("ar");
    expect(i18n.getState().numberingSystem).toBe("arab");
    i18n.setLocale("en");
    expect(i18n.getState().numberingSystem).toBe("arab"); // stays arab — explicit choice
  });

  it("ignores malformed/unavailable storage without throwing", () => {
    const junk: PreferenceStorage = {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    const i18n = createI18n({ locale: "en", storage: junk });
    expect(i18n.getState().locale).toBe("en");
    expect(() => i18n.setLocale("ar")).not.toThrow(); // setItem throws internally — swallowed
    const throwing: PreferenceStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(() => createI18n({ storage: throwing })).not.toThrow();
  });

  it("rejects malformed stored payloads", () => {
    for (const bad of [
      JSON.stringify({ v: 2, locale: "ar", digits: "default" }),
      JSON.stringify({ v: 1, locale: "fr", digits: "default" }),
      JSON.stringify({ v: 1, locale: "ar", digits: "hant" }),
      JSON.stringify([1, 2]),
      '"ar"',
    ]) {
      const storage = memoryStorage({ [PREFERENCE_STORAGE_KEY]: bad });
      const i18n = createI18n({ locale: "en", storage });
      expect(i18n.getState().locale, bad).toBe("en");
    }
  });
});

describe("localized error/status strings", () => {
  it("errorText maps worker codes to catalog strings in both locales", () => {
    const en = createI18n({ locale: "en" });
    const ar = createI18n({ locale: "ar" });
    expect(en.errorText("LIMIT_EXCEEDED")).toBe(en.t("error.LIMIT_EXCEEDED"));
    expect(ar.errorText("INVALID_FILE")).toBe(ar.t("error.INVALID_FILE"));
    expect(en.errorText("LIMIT_EXCEEDED")).not.toBe(ar.errorText("LIMIT_EXCEEDED"));
  });

  it("localeName renders the language's own name for the switcher", () => {
    const en = createI18n({ locale: "en" });
    expect(en.localeName("ar")).toBe("العربية");
    expect(en.localeName("en")).toBe("English");
  });
});
