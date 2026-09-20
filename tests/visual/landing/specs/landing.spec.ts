import { expect, test } from "@playwright/test";
import path from "node:path";
import { ARTIFACTS, entryUrl, expectLocalOnly, recordNetwork } from "../support/helpers.ts";

test.describe("landing", () => {
  test("renders and captures viewport evidence", async ({ page }, testInfo) => {
    await page.goto(entryUrl(testInfo));
    await expect(page.getByTestId("cta-demo")).toBeVisible();
    await expect(page.getByTestId("preview-stage")).toBeVisible();
    // Headline finding truth on first paint: oracle North June figure + gap.
    await expect(page.getByTestId("preview-finding")).toBeVisible();
    await page.screenshot({
      path: path.join(ARTIFACTS, `landing-${testInfo.project.name}.png`),
      fullPage: true,
    });
    await page.screenshot({
      path: path.join(ARTIFACTS, `landing-hero-${testInfo.project.name}.png`),
    });
  });

  test("demo CTA reveals the preview and scrolls it into view", async ({ page }, testInfo) => {
    await page.goto(entryUrl(testInfo));
    await page.getByTestId("cta-demo").click();
    const stage = page.getByTestId("preview-stage");
    await expect(stage).toBeInViewport();
    await expect(page.getByTestId("preview-finding")).toHaveAttribute(
      "data-revealed",
      "",
    );
    // Prepared labelling is mandatory on the sample surface.
    await expect(stage.getByText(/prepared|مُعَدّ/i).first()).toBeVisible();
  });

  test("upload CTA routes to the workspace hash after a real file pick", async ({
    page,
  }, testInfo) => {
    await page.goto(entryUrl(testInfo));
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("cta-upload").click();
    await (await chooser).setFiles({
      name: "sample_operations.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("operation_id,revenue\nOP-1,10\n"),
    });
    await page.waitForFunction(() => location.hash === "#/workspace");
  });

  test("keyboard flow: skip link lands on main, CTAs are reachable in order", async ({
    page,
  }, testInfo) => {
    await page.goto(entryUrl(testInfo));
    await page.keyboard.press("Tab");
    // Language-agnostic: the skip link is the anchor that targets #main.
    const skip = page.locator('a[href="#main"]');
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);

    // Walk forward until the demo CTA — focus must stay inside the page and
    // reach the primary action (bounded traversal, not a fixed index).
    let seen = false;
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      seen ||= await page.getByTestId("cta-demo").evaluate(
        (el) => el === document.activeElement,
      );
      if (seen) break;
    }
    expect(seen, "demo CTA reachable via keyboard").toBe(true);
  });

  test("locale link switches entry and mirrors direction", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "one run per direction");
    await page.goto("/");
    await page.getByRole("link", { name: "العربية" }).click();
    await expect(page).toHaveURL(/\/ar\//);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("makes no off-origin, non-GET or data-channel requests", async ({ page }, testInfo) => {
    const log = recordNetwork(page);
    await page.goto(entryUrl(testInfo));
    await page.getByTestId("cta-demo").click();
    await page.getByTestId("preview-finding")
      .getByRole("button", { name: /why|الحساب/i })
      .click();
    await page.getByTestId("scenario-range").fill("8");
    await page.getByRole("button", { name: /prepare|جهّز/i }).click();
    await page.waitForTimeout(300); // let any deferred load fire
    expectLocalOnly(log, test.info().project.use.baseURL);
  });
});
