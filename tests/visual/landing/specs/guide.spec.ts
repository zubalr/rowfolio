import { expect, test, type Page } from "@playwright/test";
import { entryUrl, GUIDE_DWELL_MS } from "../support/helpers.ts";

const guideBar = (page: Page) => page.getByTestId("guide-bar");
const caption = (page: Page) => page.getByTestId("guide-caption");
const activeTarget = (page: Page, step: string) =>
  page.locator(`[data-demo-target="${step}"][data-demo-active]`);

/** Advance fake time past a step's dwell and let React settle. */
async function dwell(page: Page, index: number) {
  await page.clock.runFor((GUIDE_DWELL_MS[index] ?? 0) + 250);
}

test.describe("guided demo", () => {
  test("walks the six-step storyboard and finishes complete", async ({ page }, testInfo) => {
    await page.clock.install();
    await page.goto(entryUrl(testInfo));
    await page.getByTestId("cta-guide").click();

    const bar = guideBar(page);
    await expect(bar).toBeVisible();
    await expect(caption(page)).toContainText("1/6");

    await dwell(page, 0); // intro → findings
    await expect(caption(page)).toContainText("2/6");
    await expect(activeTarget(page, "findings")).toHaveCount(1);
    await expect(page.getByTestId("preview-finding")).toHaveAttribute("data-revealed", "");

    await dwell(page, 1); // findings → evidence
    await expect(activeTarget(page, "evidence")).toHaveCount(1);
    await expect(page.getByTestId("preview-evidence")).toBeVisible();

    await dwell(page, 2); // evidence → scenario (applies +8% cost)
    await expect(activeTarget(page, "scenario")).toHaveCount(1);
    await expect(page.getByTestId("preview-scenario")).toContainText(/8%|٨٪/);

    await dwell(page, 3); // scenario → briefing (prepares artifacts)
    await expect(activeTarget(page, "briefing")).toHaveCount(1);
    await expect(page.getByTestId("preview-briefing")).toContainText(/verified|تم التحقّق/i);

    await dwell(page, 4); // briefing → complete step
    await expect(caption(page)).toContainText("6/6");
    // Complete step is last: no auto-advance beyond, bar stays until user exits.
    await dwell(page, 5);
    await expect(bar).toBeVisible();
  });

  test("manual interaction pauses the guide and it never auto-resumes", async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    await page.goto(entryUrl(testInfo));
    await page.getByTestId("cta-guide").click();
    await dwell(page, 0);
    await expect(caption(page)).toContainText("2/6");

    // A pointerdown on the preview surface = manual interaction.
    await page.getByTestId("preview-raw").dispatchEvent("pointerdown");
    await expect(
      page.getByRole("button", { name: /resume|متابعة/i }),
    ).toBeVisible();

    // More fake time than all remaining dwells — must still sit paused at 2/6.
    await page.clock.runFor(60_000);
    await expect(caption(page)).toContainText("2/6");
    await expect(guideBar(page)).toBeVisible();
  });

  test("Escape exits while preserving produced results", async ({ page }, testInfo) => {
    await page.clock.install();
    await page.goto(entryUrl(testInfo));
    await page.getByTestId("cta-guide").click();
    await dwell(page, 0);
    await dwell(page, 1); // evidence opened by the guide
    await expect(page.getByTestId("preview-evidence")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(guideBar(page)).toHaveCount(0);
    // Results persist: evidence panel stays open, finding stays revealed.
    await expect(page.getByTestId("preview-evidence")).toBeVisible();
    await expect(page.getByTestId("preview-finding")).toHaveAttribute("data-revealed", "");
  });

  test("replay resets preview state and focuses the results heading", async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    await page.goto(entryUrl(testInfo));
    await page.getByTestId("cta-guide").click();
    await dwell(page, 0);
    await dwell(page, 1);
    await dwell(page, 2);
    await dwell(page, 3);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /replay|إعادة/i }).click();
    // Baseline restored: evidence closed, scenario zeroed, briefing unprimed.
    await expect(page.getByTestId("preview-evidence")).toHaveCount(0);
    await expect(page.getByTestId("preview-scenario")).toContainText(/0%|٠٪/);
    // Focus lands on the results heading for orientation.
    await expect(page.locator("#rf-preview-title")).toBeFocused();
  });
});
