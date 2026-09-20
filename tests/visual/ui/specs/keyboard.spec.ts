/**
 * Keyboard contract: skip link is the first tab stop and lands on main;
 * focus rings are visible (3px cobalt outline + offset); field error state
 * links label/description correctly; directional icons mirror only in RTL.
 */
import { expect, test } from "@playwright/test";
import { copy, localeOf, openGallery, shot } from "./helpers.ts";

test.describe("keyboard controls", () => {
  test("skip link is first tab stop and reaches main", async ({ page }, info) => {
    const locale = localeOf(info);
    await openGallery(page, locale);

    await page.keyboard.press("Tab");
    const skip = page.locator(".rf-skip");
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible(); // revealed on focus
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  test("focus ring renders on controls and inputs", async ({ page }, info) => {
    const locale = localeOf(info);
    await openGallery(page, locale);

    // Tab past skip link + locale nav links until a button is focused.
    for (let i = 0; i < 12; i += 1) {
      const tag = await page.evaluate(() => document.activeElement?.tagName);
      if (tag === "BUTTON") break;
      await page.keyboard.press("Tab");
    }
    const ring = await page.evaluate(() => {
      const el = document.activeElement!;
      const cs = getComputedStyle(el);
      return { outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor, tag: el.tagName };
    });
    expect(ring.tag).toBe("BUTTON");
    expect(parseFloat(ring.outlineWidth)).toBeGreaterThanOrEqual(3);
    // Cobalt focus color (data #2855D9).
    expect(ring.outlineColor).toBe("rgb(40, 85, 217)");

    await shot(page, info, `focus-ring-${locale}`, { fullPage: false });
  });

  test("field error links description and marks input invalid", async ({ page }, info) => {
    const locale = localeOf(info);
    const s = copy(locale);
    await openGallery(page, locale);

    await page.getByTestId("trigger-field-error").click();
    const field = page.locator(".rf-field", { hasText: s.costError }).last();
    const input = field.locator("input");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    const describedby = await input.getAttribute("aria-describedby");
    expect(describedby).toBeTruthy();
    await expect(field.locator(`#${describedby}`)).toContainText(s.costError);
    await expect(field.locator(".rf-field__error")).toHaveAttribute("role", "alert");

    // Unit island stays LTR in both locales (first field carries unit="%").
    const unit = page.locator(".rf-field__unit").first();
    await expect(unit).toHaveAttribute("dir", "ltr");
    await expect(unit).toHaveText("%");
  });

  test("directional icons mirror in RTL, not in LTR", async ({ page }, info) => {
    const locale = localeOf(info);
    await openGallery(page, locale);

    const arrow = page
      .locator('[data-story="buttons"] .rf-btn')
      .first()
      .locator(".rf-icon--mirror");
    const transform = await arrow.evaluate((el) => getComputedStyle(el).transform);
    if (locale === "ar") {
      expect(transform).toContain("matrix(-1");
    } else {
      expect(["none", ""]).toContain(transform);
    }
    // Non-directional icon (close) never mirrors.
    const closeIcon = page.locator('[data-story="buttons"] .rf-btn--icon-only .rf-icon');
    const closeTransform = await closeIcon.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    expect(["none", ""]).toContain(closeTransform);
  });
});
