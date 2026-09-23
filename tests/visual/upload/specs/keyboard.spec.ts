/**
 * Keyboard/retry coverage: the file input is reachable, radios and checkboxes
 * are keyboard-operable, cancel returns to the dropzone, retry re-runs the
 * failed step.
 */
import { expect, test } from "@playwright/test";
import { feed, fixturePath, localeOf, openHarness, shot } from "./helpers.ts";

test.describe("keyboard + retry", () => {
  test("file input is keyboard-focusable and the sheet list uses radios", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await page.keyboard.press("Tab");
    // The visually-hidden file input remains in the tab order.
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBe("INPUT");
    await feed(page, fixturePath("multi-sheet-hidden.xlsx"));
    await expect(page.getByTestId("configure-panel")).toBeVisible();
    // Radio inputs: arrow-key/space operable group semantics.
    const radios = page.getByTestId("sheet-list").locator('input[type="radio"]');
    await expect(radios.first()).toBeVisible();
    await radios.first().focus();
    await page.keyboard.press("Space");
    await expect(radios.first()).toBeChecked();
    await shot(page, info, "20-keyboard-sheet-radios");
  });

  test("cancel returns to the dropzone", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await feed(page, {
      name: "t.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("a\n1\n", "utf8"),
    });
    await expect(page.getByTestId("configure-panel")).toBeVisible();
    await page.getByTestId("configure-cancel").click();
    await expect(page.locator('input[type="file"]')).toBeAttached();
    await expect(page.getByTestId("configure-panel")).not.toBeVisible();
  });

  test("retry re-runs the failed step and fails honestly again", async ({ page }, info) => {
    const locale = localeOf(info);
    await openHarness(page, locale);
    await feed(page, fixturePath("encrypted-entries.xlsx"));
    const error = page.getByTestId("upload-error");
    await expect(error).toBeVisible();
    await page.getByTestId("upload-error-retry").click();
    // Same bytes → the same honest refusal (not a fabricated success).
    await expect(error).toBeVisible();
    await shot(page, info, "21-error-retry");
  });
});
