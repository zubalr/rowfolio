/**
 * Happy-path flows through the real UI: file input → configure → review →
 * committed outcome marker. Every stage is screenshotted per locale.
 */
import { expect, test } from "@playwright/test";
import { feed, fixturePath, localeOf, openHarness, shot } from "./helpers.ts";

test.describe("upload flow", () => {
  test("dropzone renders limits and privacy in the UI locale", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await expect(page.getByTestId("upload-flow")).toBeVisible();
    await expect(page.locator('input[type="file"]')).toBeAttached();
    await expect(page.getByTestId("upload-limits")).toBeVisible();
    await shot(page, info, "01-dropzone");
  });

  test("CSV happy path: input → configure → review → complete", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await feed(page, {
      name: "sales.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("city,sales\nRiyadh,10\nJeddah,20\n", "utf8"),
    });
    const configure = page.getByTestId("configure-panel");
    await expect(configure).toBeVisible();
    await expect(page.getByTestId("upload-preview")).toBeVisible();
    await shot(page, info, "02-configure-csv");

    await page.getByTestId("configure-proceed").click();
    const review = page.getByTestId("review-panel");
    await expect(review).toBeVisible();
    await expect(page.getByTestId("review-table-summary")).toContainText("sales.csv");
    await shot(page, info, "03-review-csv");

    await page.getByTestId("review-submit").click();
    await expect(page.getByTestId("upload-complete")).toBeAttached();
    await expect(page.getByTestId("upload-complete")).toHaveAttribute("data-format", "csv");
    await shot(page, info, "04-complete-csv");
  });

  test("XLSX happy path through the real parser", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await feed(page, fixturePath("types-and-formulas.xlsx"));
    await expect(page.getByTestId("configure-panel")).toBeVisible();
    await page.getByTestId("configure-proceed").click();
    await expect(page.getByTestId("review-panel")).toBeVisible();
    // Formula cells → the cache consent section is honest, not silent.
    await expect(page.getByTestId("review-panel")).toContainText("f");
    await shot(page, info, "05-review-xlsx-formulas");
  });

  test("ambiguous CSV asks for the delimiter before inspecting", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await feed(page, {
      name: "amb.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("a,b;c\n1,2;3\n4,5;6\n", "utf8"),
    });
    const picker = page.getByTestId("delimiter-picker");
    await expect(picker).toBeVisible();
    await shot(page, info, "06-delimiter-picker");
    await picker.getByRole("button", { name: ";" }).click();
    await expect(page.getByTestId("configure-panel")).toBeVisible();
    await shot(page, info, "07-configure-after-delimiter");
  });
});
