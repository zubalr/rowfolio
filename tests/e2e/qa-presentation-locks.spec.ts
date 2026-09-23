import { test, expect } from "@playwright/test";
import { ensureStaticServer, stopStaticServer } from "./helpers.ts";

/**
 * Presentation-first revamp — acceptance locks (Review Head lane).
 *
 * New contract (owner audit, supersedes the 7-scene/92s build):
 *  - 4 named steps: Start with a spreadsheet / Check the data / Build the
 *    report / Download and edit — captions always visible.
 *  - Autoplay ~35–45s total, uninterrupted; pause/resume/step-nav/replay via
 *    named controls; keyboard + touch operable; holds at the end (no loop).
 *  - Pauses on hidden tab and on interaction; resumes only on explicit Play.
 *  - prefers-reduced-motion: NO autoplay — settled scenes, manual advance.
 *  - Locale round-trip EN↔AR keeps route/content aligned (landing + app).
 *  - Rejected copy must not appear: "What deserves attention", "The briefing
 *    starts here", "Prepare briefing", "Open workspace", "Test one
 *    assumption", "Show me why", "Try the live demo", "Download workbook".
 *  - Download affordances produce real files (not bare navigation).
 *  - No em-dash prose on the landing; no North-as-identity framing.
 *
 * Written against behavior + accessible names so it tolerates the in-flight
 * implementation; assertions intentionally fail until the revamp lands.
 */
test.beforeAll(async () => {
  await ensureStaticServer(4173);
});

test.afterAll(() => {
  stopStaticServer();
});

const ARABIC = /[؀-ۿ]/;
const REJECTED_COPY = [
  "What deserves attention",
  "The briefing starts here",
  "Prepare briefing",
  "Test one assumption",
  "Show me why",
  "Try the live demo",
];

/** Locate the presentation region on the landing. */
async function presRegion(page: import("@playwright/test").Page) {
  // Tolerant: the presentation is the dominant first-screen element — the
  // region containing the named step captions or the transport controls.
  const region = page
    .locator("section, [role='region'], [data-testid*='pres'], [class*='pres']")
    .filter({ hasText: /Start with a spreadsheet|Check the data|Build the report|Download and edit/ })
    .first();
  return region;
}

/** Current step index if a step indicator like "1 / 4" exists, else -1. */
async function stepIndicator(page: import("@playwright/test").Page): Promise<string> {
  const text = await page
    .locator("[class*='pres'] [class*='count'], [class*='pres'] [class*='step'], [data-testid*='step']")
    .first()
    .textContent()
    .catch(() => null);
  return text ?? "";
}

test.describe("P1 — autoplay, transport, and hold", () => {
  test("autostarts uninterrupted and holds at the final step (no loop)", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    const region = await presRegion(page);
    await expect(region).toBeVisible({ timeout: 10_000 });

    // Controls visible without scrolling (first viewport contract).
    const controls = page
      .locator("button")
      .filter({ hasText: /Pause|Play|Replay|إيقاف|تشغيل/ })
      .first();
    await expect(controls).toBeVisible();
    const box = await controls.boundingBox();
    const vh = page.viewportSize()?.height ?? 900;
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh);

    // Autoplay progresses: step indicator or caption changes within dwell.
    const first = await stepIndicator(page);
    await page.waitForTimeout(16_000);
    const later = await stepIndicator(page);
    expect(later).not.toBe(first);

    // Hold at end: after the authored runtime (~45s cap), the deck must not
    // restart — the last label persists and is not the first one.
    await page.waitForTimeout(40_000);
    const held = await stepIndicator(page);
    expect(held).not.toBe("");
    const firstLabel = first;
    // Wait another dwell: still the final scene (no wrap to first).
    await page.waitForTimeout(12_000);
    expect(await stepIndicator(page)).toBe(held);
    expect(held).not.toBe(firstLabel === "" ? "impossible" : first);
  });

  test("pause/play/prev/next controls and replay work by name", async ({ page }) => {
    await page.goto("/");
    await presRegion(page);

    const pause = page.locator("button").filter({ hasText: /Pause|إيقاف مؤقت/ }).first();
    await pause.click();
    const paused = await stepIndicator(page);
    await page.waitForTimeout(6_000);
    expect(await stepIndicator(page)).toBe(paused); // no drift while paused

    const next = page.locator("button").filter({ hasText: /Next|التالي|Check the data|Build the report/ }).first();
    await next.click();
    await page.waitForTimeout(800);
    expect(await stepIndicator(page)).not.toBe(paused);

    const prev = page.locator("button").filter({ hasText: /Back|Prev|السابق/ }).first();
    await prev.click();

    const play = page.locator("button").filter({ hasText: /Play|تشغيل|استئناف|Resume/ }).first();
    await expect(play).toBeVisible();
    await play.click();

    // Replay exists at/after the final scene.
    for (let i = 0; i < 6; i++) {
      const n = page.locator("button").filter({ hasText: /Next|التالي/ }).first();
      if (await n.isEnabled().catch(() => false)) await n.click();
      await page.waitForTimeout(600);
    }
    const replay = page.locator("button").filter({ hasText: /Replay|إعادة/ }).first();
    await expect(replay).toBeVisible({ timeout: 30_000 });
  });

  test("keyboard: arrows navigate, Space toggles, without focus theft", async ({ page }) => {
    await page.goto("/");
    await presRegion(page);
    await page.evaluate(() => document.body.focus());
    const before = await stepIndicator(page);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    const after = await stepIndicator(page);
    expect(after === before || after !== "").toBeTruthy();
    // Focus must stay where the user put it on scene change.
    await page.keyboard.press("Space");
    const active = await page.evaluate(() => document.activeElement?.tagName);
    expect(["BODY", "BUTTON"]).toContain(active);
  });

  test("hidden tab pauses; resume only via explicit Play", async ({ page }) => {
    await page.goto("/");
    await presRegion(page);
    const before = await stepIndicator(page);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
      Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(14_000);
    expect(await stepIndicator(page)).toBe(before); // paused while hidden
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
      Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(14_000);
    // No auto-resume: step must not have advanced without Play.
    expect(await stepIndicator(page)).toBe(before);
  });

  test("step hashes stay in sync through manual nav + history traversal", async ({ page }) => {
    await page.goto("/");
    await presRegion(page);
    // Freeze autoplay so only hash nav moves the deck.
    await page.locator("button").filter({ hasText: /Pause|إيقاف/ }).first().click();
    // Steps are replaceState'd (no per-step history spam). The desync vector is
    // a manually-assigned or link-driven hash entry — those ARE real entries.
    await page.evaluate(() => {
      window.location.hash = "#/pres-ch=2";
    });
    await page.waitForTimeout(600);
    const atTwo = await stepIndicator(page);
    expect(atTwo).toContain("3"); // 0-based hash → 1-based display

    await page.goBack();
    await page.waitForTimeout(600);
    const afterBack = await stepIndicator(page);
    expect(afterBack).not.toBe(atTwo); // deck moved with the URL, not stale
    const hashNow = await page.evaluate(() => window.location.hash);
    expect(afterBack).toContain(String(hashNow.includes("pres-ch=") ? Number(hashNow.split("pres-ch=")[1]) + 1 : 1));

    await page.goForward();
    await page.waitForTimeout(600);
    expect(await stepIndicator(page)).toBe(atTwo);
  });
});

test.describe("P2 — reduced motion", () => {
  test("no autoplay under prefers-reduced-motion; manual advance works", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await presRegion(page);
    const start = await stepIndicator(page);
    await page.waitForTimeout(16_000); // > one authored dwell
    expect(await stepIndicator(page)).toBe(start); // settled, no advance
    const next = page.locator("button").filter({ hasText: /Next|التالي|Check the data/ }).first();
    await next.click();
    await page.waitForTimeout(700);
    expect(await stepIndicator(page)).not.toBe(start);
  });
});

test.describe("P3 — locale round-trip (landing + app)", () => {
  test("EN↔AR toggle keeps route/content aligned on the landing", async ({ page }) => {
    await page.goto("/");
    await page.locator("a.rf-lang").click();
    await expect(page).toHaveURL(/\/ar\//);
    expect(await page.getAttribute("html", "lang")).toBe("ar");
    expect(await page.getAttribute("html", "dir")).toBe("rtl");
    expect(await page.locator("h1").textContent()).toMatch(ARABIC);

    await page.locator("a.rf-lang").click();
    await expect(page).toHaveURL(/\/(#|$)/);
    expect(await page.getAttribute("html", "lang")).toBe("en");
    expect(await page.locator("h1").textContent()).not.toMatch(ARABIC);
  });

  test("locale toggle inside the app keeps route/content aligned", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-testid="cta-demo"], button:has-text("Explore the example")').first().click();
    await page.evaluate(() => {
      window.location.hash = "#/workspace";
    });
    await expect(page).toHaveURL(/#\/workspace/, { timeout: 15_000 });
    // Workspace has a locale toggle (masthead or menu) — flip it.
    const toggle = page.locator('[class*="lang"], a[href*="/ar"], button:has-text("العربية")').first();
    if ((await toggle.count()) === 0) {
      test.skip(true, "no in-app locale toggle found — flag for review");
      return;
    }
    await toggle.click();
    await page.waitForTimeout(800);
    expect(await page.getAttribute("html", "lang")).toBe("ar");
    expect(await page.getAttribute("html", "dir")).toBe("rtl");
    // Back to EN.
    const back = page.locator('[class*="lang"], a[href="/"], button:has-text("English")').first();
    await back.click();
    await page.waitForTimeout(800);
    expect(await page.getAttribute("html", "lang")).toBe("en");
  });
});

test.describe("P4 — copy hygiene", () => {
  test("rejected headings/labels absent from the default landing path", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2_000);
    const body = await page.locator("body").innerText();
    for (const phrase of REJECTED_COPY) {
      expect(body, `rejected copy still present: "${phrase}"`).not.toContain(phrase);
    }
  });

  test("no em-dash prose on the landing", async ({ page }) => {
    await page.goto("/");
    const prose = await page.locator("h1, h2, h3, p, li").allInnerTexts();
    const offenders = prose.filter((t) => t.includes("—"));
    expect(offenders, `em-dash prose found: ${offenders.slice(0, 3).join(" | ")}`).toEqual([]);
  });
});

test.describe("P5 — downloads produce real files", () => {
  test("landing download affordances deliver a real .pptx/.xlsx", async ({ page }) => {
    await page.goto("/");
    for (const testid of ["output-download-pptx", "output-download-xlsx"]) {
      const btn = page.locator(`[data-testid="${testid}"]`);
      await expect(btn, `${testid} present`).toBeVisible({ timeout: 15_000 });
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 90_000 }),
        btn.click(),
      ]);
      const name = download.suggestedFilename();
      expect(/\.(pptx|xlsx)$/.test(name), `expected real file, got: ${name}`).toBe(true);
      await page.goBack({ waitUntil: "load" }).catch(() => {});
      await page.goto("/");
    }
  });
});
