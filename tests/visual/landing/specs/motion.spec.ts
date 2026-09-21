import { expect, test } from "@playwright/test";
import { entryUrl, GUIDE_DWELL_MS } from "../support/helpers.ts";

test.describe("motion contract", () => {
  test("full motion: dwell auto-advances and the travelling ring is mounted", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "reduced-motion",
      "runs on motion-allowed projects",
    );
    await page.clock.install();
    await page.goto(entryUrl(testInfo));
    await page.getByTestId("cta-guide").click();
    await expect(page.getByTestId("guide-bar")).toBeVisible();
    // The lazy GuideHighlight overlay only mounts while the guide runs with
    // motion allowed.
    await expect(page.locator(".rf-demo-ring")).toBeVisible();
    await page.clock.runFor(GUIDE_DWELL_MS[0] + 250);
    await expect(page.getByTestId("guide-caption")).toContainText("2/6");
  });

  test("reduced motion: never auto-advances and mounts no animated overlay", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "reduced-motion",
      "runs only on the reduced-motion project",
    );
    await page.clock.install();
    await page.goto(entryUrl(testInfo));
    await page.getByTestId("cta-guide").click();
    const bar = page.getByTestId("guide-bar");
    await expect(bar).toBeVisible();
    await expect(page.locator(".rf-demo-ring")).toHaveCount(0);

    // Far more than every dwell combined — guide must remain user-driven.
    await page.clock.runFor(120_000);
    await expect(page.getByTestId("guide-caption")).toContainText("1/6");

    // Explicit consent still steps forward — the Next control names the
    // destination step's caption ("Results from this spreadsheet" / "نتائج من جدول البيانات هذا").
    await page
      .getByTestId("guide-bar")
      .getByRole("button", { name: /attention|الانتباه/i })
      .click();
    await expect(page.getByTestId("guide-caption")).toContainText("2/6");
  });
});
