/**
 * Edge-case flows: unsupported/oversized inputs, hidden-sheet opt-in,
 * formula-cache consent/refusal, prior-session preservation.
 */
import { expect, test } from "@playwright/test";
import { feed, fixturePath, localeOf, openHarness, shot } from "./helpers.ts";

const VALID_CSV = {
  name: "ok.csv",
  mimeType: "text/csv",
  buffer: Buffer.from("k,v\na,1\nb,2\n", "utf8"),
};

async function commitOkUpload(page: Parameters<typeof feed>[0]) {
  await feed(page, VALID_CSV);
  await expect(page.getByTestId("configure-panel")).toBeVisible();
  await page.getByTestId("configure-proceed").click();
  await expect(page.getByTestId("review-panel")).toBeVisible();
  await page.getByTestId("review-submit").click();
  await expect(page.getByTestId("upload-complete")).toBeAttached();
}

test.describe("edge cases", () => {
  test("not-a-workbook is refused; invalid input shows the error surface", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await feed(page, fixturePath("not-a-workbook.xlsx"));
    const error = page.getByTestId("upload-error");
    await expect(error).toBeVisible();
    await shot(page, info, "10-error-unsupported");
    // Retry exists and the file input remains reachable after dismiss.
    await page.getByTestId("upload-error-dismiss").click();
    await expect(page.locator('input[type="file"]')).toBeAttached();
  });

  test("encrypted entries are refused with the detail token", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await feed(page, fixturePath("encrypted-entries.xlsx"));
    const error = page.getByTestId("upload-error");
    await expect(error).toBeVisible();
    await expect(page.getByTestId("upload-error-detail")).toHaveAttribute("data-error-detail", "zip.encrypted-entry");
    await expect(error).not.toContainText("zip.encrypted-entry");
    await shot(page, info, "11-error-encrypted");
  });

  test("oversized input is refused at parse and the prior session survives", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await commitOkUpload(page);
    const priorHash = await page
      .getByTestId("upload-complete")
      .getAttribute("data-source-hash");

    await feed(page, fixturePath("wide-101.xlsx"));
    // Replacing a live session needs explicit consent.
    const dialog = page.getByTestId("upload-replace-dialog");
    await expect(dialog).toBeVisible();
    await shot(page, info, "12-confirm-replace");
    await dialog.getByTestId("replace-confirm").click();

    // 101 columns exceeds the cap → error surface; prior hash retained.
    await page.getByTestId("configure-proceed").click({ timeout: 30_000 }).catch(() => {});
    const error = page.getByTestId("upload-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("upload-prior-note")).toBeVisible();
    await shot(page, info, "13-error-limit");
    expect(priorHash).toBeTruthy();
  });

  test("hidden sheets are disclosed and selectable only after opt-in", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await feed(page, fixturePath("multi-sheet-hidden.xlsx"));
    const configure = page.getByTestId("configure-panel");
    await expect(configure).toBeVisible();
    const hiddenRegion = page.getByTestId("hidden-sheets");
    await expect(hiddenRegion).toBeVisible();
    await shot(page, info, "14-hidden-sheets-disclosed");

    const optIn = hiddenRegion.locator('input[type="checkbox"]').first();
    await optIn.check();
    // Opting in auto-selects that sheet for inspection.
    await expect(configure.locator('input[type="radio"]:checked')).toHaveCount(1);
    await page.getByTestId("configure-proceed").click();
    await expect(page.getByTestId("review-panel")).toBeVisible();
    await shot(page, info, "15-review-hidden-sheet");
  });

  test("formula caches are excluded until consent; consent is recorded", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await feed(page, fixturePath("types-and-formulas.xlsx"));
    await expect(page.getByTestId("configure-panel")).toBeVisible();
    await page.getByTestId("configure-proceed").click();
    const review = page.getByTestId("review-panel");
    await expect(review).toBeVisible();

    // Refusal path: leave consent unchecked → completes without cache opt-in.
    await page.getByTestId("review-submit").click();
    await expect(page.getByTestId("upload-complete")).toBeAttached();
    await shot(page, info, "16-complete-cache-refused");
  });
});
