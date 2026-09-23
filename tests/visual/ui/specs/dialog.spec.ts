/**
 * Dialog focus contract (16_ACCESSIBILITY_SPEC): heading takes initial focus,
 * Tab/Shift+Tab stay contained, Escape closes through a single path, focus
 * returns to the trigger, and page scroll stays locked while open.
 * Covers the dark evidence drawer and the centered paper dialog.
 */
import { expect, test, type Page } from "@playwright/test";
import { copy, localeOf, openGallery, shot } from "./helpers.ts";

async function trigger(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await button.scrollIntoViewIfNeeded();
  await button.click();
  return button;
}

test.describe("dialog focus", () => {
  test("evidence drawer: trap, escape, restore, scroll lock", async ({ page }, info) => {
    const locale = localeOf(info);
    const s = copy(locale);
    await openGallery(page, locale);

    const button = await trigger(page, s.openPanel);
    const dialog = page.locator('dialog[data-testid="evidence-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("open", "");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAttribute("data-rf-surface", "ink");

    // Initial focus lands on the heading.
    const focusedIsTitle = await page.evaluate(() =>
      document.activeElement?.classList.contains("rf-dialog__title"),
    );
    expect(focusedIsTitle).toBe(true);

    // Page scroll is locked.
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    // Real keyboard traversal: Tab cycles through the drawer and back onto
    // itself without focus escaping to the page.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const el = document.querySelector('dialog[data-testid="evidence-dialog"]')!;
        const active = document.activeElement as HTMLElement | null;
        return !!active && (el.contains(active) || active === el);
      });
      expect(inside).toBe(true);
    }
    // Shift+Tab wraps back without escaping.
    await page.keyboard.press("Shift+Tab");
    const stillInside = await page.evaluate(() => {
      const el = document.querySelector('dialog[data-testid="evidence-dialog"]')!;
      const active = document.activeElement as HTMLElement | null;
      return !!active && el.contains(active);
    });
    expect(stillInside).toBe(true);

    await shot(page, info, `evidence-drawer-${locale}`);

    // Escape closes; focus returns to the trigger; scroll restores.
    // Poll: [open] removal is synchronous but the React close path (focus
    // restore + scroll unlock) commits on the next frame.
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("");
    await expect(button).toBeFocused();
  });

  test("centered paper dialog: title focus, close button path", async ({ page }, info) => {
    const locale = localeOf(info);
    const s = copy(locale);
    await openGallery(page, locale);

    await trigger(page, s.openCenter);
    const dialog = page.locator('dialog[data-testid="center-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toHaveAttribute("data-rf-surface", "ink");
    const focusedIsTitle = await page.evaluate(() =>
      document.activeElement?.classList.contains("rf-dialog__title"),
    );
    expect(focusedIsTitle).toBe(true);

    await shot(page, info, `center-dialog-${locale}`);

    // Footer button path also closes (single close path).
    await page.getByRole("button", { name: s.back, exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
});
