import { test, expect } from "@playwright/test";
import { ensureStaticServer, stopStaticServer } from "./helpers.ts";

/**
 * Phase-1 acceptance regression locks (Review Head lane).
 *
 * Locks reproduced acceptance failures from the live-site audit:
 *  R1 — locale race: content must always match the route ("/"=EN, "/ar/"=AR)
 *       in both toggle directions, on direct loads, and through history.
 *  R2 — evidence calc: the sample's 8% order-volume finding must resolve to a
 *       defined, verified result — never "Not defined"/"Something went wrong".
 *  R3 (mobile guide occlusion) is RETIRED — the revamp removed the specimen
 *       tour; mobile transport coverage moved to qa-presentation-locks.spec.ts.
 */
test.beforeAll(async () => {
  await ensureStaticServer(4173);
});

test.afterAll(() => {
  stopStaticServer();
});

const PREF_KEY = "rowfolio.i18n.v1";

async function htmlAttrs(page: import("@playwright/test").Page) {
  return {
    lang: await page.getAttribute("html", "lang"),
    dir: (await page.getAttribute("html", "dir")) ?? "ltr",
  };
}

test.describe("R1 — locale race: content always matches route", () => {
  test("EN→AR toggle navigates to /ar/ and renders Arabic", async ({ page }) => {
    await page.goto("/");
    await page.locator("a.rf-lang").click();
    await expect(page).toHaveURL(/\/ar\/(#\/pres-ch=\d+)?$/);
    const { lang, dir } = await htmlAttrs(page);
    expect(lang).toBe("ar");
    expect(dir).toBe("rtl");
    expect(await page.locator("h1").textContent()).toMatch(/[؀-ۿ]/);
  });

  test("AR→EN toggle navigates to / and renders English", async ({ page }) => {
    await page.goto("/ar/");
    await page.locator("a.rf-lang").click();
    await expect(page).toHaveURL(/\/(#\/pres-ch=\d+)?$/);
    const { lang, dir } = await htmlAttrs(page);
    expect(lang).toBe("en");
    expect(dir).toBe("ltr");
    expect(await page.locator("h1").textContent()).not.toMatch(/[؀-ۿ]/);
  });

  test("round-trip toggle twice stays consistent on every leg", async ({ page }) => {
    await page.goto("/");
    for (let i = 0; i < 2; i += 1) {
      await page.locator("a.rf-lang").click();
      await expect(page).toHaveURL(/\/ar\/(#\/pres-ch=\d+)?$/);
      expect((await htmlAttrs(page)).lang).toBe("ar");
      await page.locator("a.rf-lang").click();
      await expect(page).toHaveURL(/\/(#\/pres-ch=\d+)?$/);
      expect((await htmlAttrs(page)).lang).toBe("en");
    }
  });

  test("stored preference never overrides the route", async ({ page }) => {
    // Stored 'ar' + direct load of '/' must still render EN.
    await page.goto("/");
    await page.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify({ v: 1, locale: "ar", digits: "default" }));
    }, PREF_KEY);
    await page.reload();
    expect((await htmlAttrs(page)).lang).toBe("en");

    // Stored 'en' + direct load of '/ar/' must render AR.
    await page.goto("/");
    await page.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify({ v: 1, locale: "en", digits: "default" }));
    }, PREF_KEY);
    await page.goto("/ar/");
    const { lang, dir } = await htmlAttrs(page);
    expect(lang).toBe("ar");
    expect(dir).toBe("rtl");
  });

  test("history back/forward keeps content aligned with the route", async ({ page }) => {
    await page.goto("/");
    await page.locator("a.rf-lang").click();
    await expect(page).toHaveURL(/\/ar\/(#\/pres-ch=\d+)?$/);
    expect((await htmlAttrs(page)).lang).toBe("ar");
    await page.goBack();
    await expect(page).toHaveURL(/\/(#\/pres-ch=\d+)?$/);
    expect((await htmlAttrs(page)).lang).toBe("en");
    await page.goForward();
    await expect(page).toHaveURL(/\/ar\/(#\/pres-ch=\d+)?$/);
    expect((await htmlAttrs(page)).lang).toBe("ar");
  });
});

test.describe("R2 — evidence drawer resolves composite proofs", () => {
  test("8% order-volume finding shows a defined verified result", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-testid="cta-demo"]').click();
    await page.evaluate(() => {
      window.location.hash = "#/workspace";
    });
    await expect(page).toHaveURL(/#\/workspace/, { timeout: 15_000 });
    await expect(page.locator("text=Example analysis")).toBeVisible({ timeout: 15_000 });

    // "More orders. Still below target." — the finding whose composite proof
    // (10800−10000)/10000 regressed to "= Not defined" + "Something went wrong."
    const card = page
      .locator(".rf-finding")
      .filter({ hasText: "More orders. Still below target." })
      .first();
    await expect(card).toBeVisible();
    await card.locator('[data-testid="view-evidence-btn"]').click();

    const drawer = page.locator('[data-testid="evidence-dialog"]');
    await drawer.waitFor({ state: "visible", timeout: 4000 });

    await expect(drawer.locator(".rf-evidence__undefined")).toHaveCount(0);
    await expect(drawer).not.toContainText("Something went wrong");
    await expect(drawer.locator(".rf-evidence__verified").first()).toBeVisible();
    // The composite proof lands on 0.08 — rendered as a percent somewhere.
    await expect(drawer).toContainText(/0\.08|8%/);
  });
});
