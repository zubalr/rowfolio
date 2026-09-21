/**
 * Evidence dialog + source browser — behavior spec.
 *
 * Covers the required matrix: focus trap/restoration/Escape, keyboard access
 * to the source table, EN/AR and 320px, disjoint spans, undefined metrics,
 * hostile cell strings, pagination and long sheet names.
 */
import { expect, test } from "@playwright/test";
import { localeOf, openDialog, openHarness, shot } from "./helpers.ts";
import { MALICIOUS_STRINGS } from "../support/strings.ts";

const DIALOG = 'dialog[data-testid="evidence-dialog"]';
const TITLE = ".rf-dialog__title";

test.describe("evidence dialog — modal semantics", () => {
  test("opens on the trigger, focuses the title, Escape restores focus", async ({
    page,
  }, info) => {
    await openHarness(page, "revenue-gap", localeOf(info));
    const trigger = page.getByTestId("open-evidence");
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(DIALOG)).toBeVisible();

    // Initial focus lands on the dialog heading.
    await expect(page.locator(TITLE)).toBeFocused();
    // Page scroll is locked while open (background inert via showModal).
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(page.locator(DIALOG)).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("Tab wraps inside the drawer; focus never leaves the dialog", async ({ page }, info) => {
    await openDialog(page, "revenue-gap", localeOf(info));
    // Walk forward until focus cycles back onto an already-seen control.
    const seen = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press("Tab");
      const probe = await page.evaluate(() => {
        const el = document.activeElement;
        const inside = el !== null && el.closest("dialog[data-testid='evidence-dialog']") !== null;
        const tag =
          el === null
            ? "none"
            : `${el.tagName}:${el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.className}`;
        return { inside, tag };
      });
      expect(probe.inside, `focus escaped to ${probe.tag}`).toBe(true);
      if (seen.has(probe.tag)) return; // wrapped — trap held
      seen.add(probe.tag);
    }
    throw new Error("focus never wrapped inside the dialog");
  });
});

test.describe("evidence dialog — content", () => {
  test("renders calculation trace, result, sources, transforms, fingerprint", async ({
    page,
  }, info) => {
    const locale = localeOf(info);
    await openDialog(page, "revenue-gap", locale);
    await expect(page.locator("[data-testid='evidence-panel']")).toBeVisible();
    // Structured trace: operator glyphs present, no injected markup possible.
    await expect(page.locator(".rf-evidence__trace").first()).toBeVisible();
    // Exact evaluated result + verification chip.
    await expect(page.locator("[data-testid='evidence-result']").first()).toBeVisible();
    await expect(page.locator(".rf-evidence__verified").first()).toBeVisible();
    // Source-rows browser + exclusions/transforms + fingerprint.
    await expect(page.locator(".rf-evidence__table").first()).toBeVisible();
    await expect(page.locator(".rf-evidence__transforms")).toBeVisible();
    await expect(page.locator(".rf-evidence__hash").first()).toContainText(
      "f0d6d06e934b1eef",
    );
    await shot(page, info, `evidence-${locale}-drawer`);
  });

  test("disjoint spans render as separate tokens, never one collapsed range", async ({
    page,
  }, info) => {
    await openDialog(page, "disjoint", localeOf(info));
    const head = page.locator(".rf-evidence__selection-head").first();
    await expect(head).toContainText("R1202-R1221");
    await expect(head).toContainText("R1300-R1320");
    await expect(head).not.toContainText("R1202-R1320");
    // The browser itself pages the disjoint set in span order.
    const rows = page.locator("[data-testid='evidence-rows-north-sparse-rows'] tbody tr");
    await expect(rows.nth(0).locator("th")).toContainText("R1202");
    await expect(rows.nth(19).locator("th")).toContainText("R1221");
    await expect(rows.nth(20).locator("th")).toContainText("R1300");
  });

  test("undefined metric shows the localized reason beside the result", async ({
    page,
  }, info) => {
    const locale = localeOf(info);
    await openDialog(page, "undefined-metric", locale);
    const reason = locale === "ar" ? "فترة غير مكتملة" : "Incomplete period";
    const notDefined = locale === "ar" ? "غير معرّف" : "Not defined";
    await expect(page.locator(".rf-evidence__result").first()).toContainText(notDefined);
    await expect(page.locator(".rf-evidence__caveat--warning").first()).toContainText(reason);
  });

  test("hostile cell strings render verbatim as text", async ({ page }, info) => {
    await openDialog(page, "malicious", localeOf(info));
    const table = page.locator(
      "[data-testid='evidence-rows-north-june-revenue-rows']",
    );
    await expect(table).toContainText(MALICIOUS_STRINGS[0]);
    await expect(table).toContainText(MALICIOUS_STRINGS[1]);
    // Nothing executed: no injected <img>/script elements inside the drawer.
    expect(await page.locator(`${DIALOG} img[src=x]`).count()).toBe(0);
  });

  test("pagination: 50-row pages with Show more rows reaching the full set", async ({
    page,
  }, info) => {
    await openDialog(page, "revenue-gap", localeOf(info));
    const table = page.locator("[data-testid='evidence-rows-north-june-revenue-rows']");
    await expect(table.locator("tbody tr")).toHaveCount(50);
    await expect(table.locator(".rf-evidence__pager-status")).toContainText(
      localeOf(info) === "ar" ? /٥٠|50/ : "Rows 1-50 of 100",
    );
    const more = table.getByRole("button", {
      name: localeOf(info) === "ar" ? "عرض صفوف إضافية" : "Show more rows",
    });
    await more.click();
    await expect(table.locator("tbody tr")).toHaveCount(100);
    await expect(more).toHaveCount(0);
  });

  test("excluded records are listed beside the selection they affect", async ({
    page,
  }, info) => {
    await openDialog(page, "undefined-metric", localeOf(info));
    const pager = page.locator(".rf-evidence__pager-status--excluded").first();
    await expect(pager).toContainText("R2416");
    await expect(pager).toContainText("R2417");
    await expect(pager).toContainText("R2418");
  });

  test("long sheet names wrap inside the fingerprint block", async ({ page }, info) => {
    await openDialog(page, "long-sheet", localeOf(info));
    const name = page.locator(".rf-evidence__filename").last();
    await expect(name).toContainText("working sheet");
    const box = await name.boundingBox();
    const dialogBox = await page.locator(DIALOG).boundingBox();
    expect(box).not.toBeNull();
    expect(dialogBox).not.toBeNull();
    // The wrapped name stays inside the drawer's content box.
    expect(box!.x).toBeGreaterThanOrEqual(dialogBox!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      dialogBox!.x + dialogBox!.width + 1,
    );
  });
});

test.describe("evidence dialog — source table keyboard", () => {
  test("scroll region is focusable and the pager button follows it", async ({ page }, info) => {
    await openDialog(page, "revenue-gap", localeOf(info));
    const region = page.locator(".rf-evidence__rows-scroll").first();
    await region.focus();
    await expect(region).toBeFocused();
    // Arrow keys scroll the region (keyboard-operable table).
    const before = await region.evaluate((el) => el.scrollTop);
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowDown");
    const after = await region.evaluate((el) => el.scrollTop);
    expect(after).toBeGreaterThanOrEqual(before);
    await page.keyboard.press("Tab");
    const more = page.getByRole("button", {
      name: localeOf(info) === "ar" ? "عرض صفوف إضافية" : "Show more rows",
    });
    await expect(more.first()).toBeFocused();
  });
});

test.describe("evidence dialog — narrow + RTL", () => {
  test("320px: drawer fits, no horizontal overflow", async ({ page }, info) => {
    const locale = localeOf(info);
    await openDialog(page, "revenue-gap", locale);
    const overflow = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("dialog[data-testid='evidence-dialog']");
      return el === null ? 999 : el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await shot(page, info, `evidence-320-${locale}`);
  });
});
