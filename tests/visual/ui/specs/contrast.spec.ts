/**
 * Rendered-contrast evidence: recomputes WCAG ratios for the visible text
 * elements of every primitive, both surfaces and locales. The math is the
 * package's own contrast module (same code the token suite validates against
 * validation/contrast.json); thresholds follow WCAG 1.4.3 — 4.5:1 normal,
 * 3:1 for large text (>=24px, or >=18.66px bold) and graphical accents.
 */
import { expect, test } from "@playwright/test";
import { contrastRatio } from "../../../../packages/ui/src/contrast.ts";
import { copy, localeOf, openGallery } from "./helpers.ts";

interface Probe {
  /** Human label for failure output. */
  label: string;
  selector: string;
  /** Element whose color is measured (defaults to selector itself). */
  textSelector?: string;
  /** Minimum contrast — 4.5 body, 3 large text / icons. */
  min?: number;
}

const LIGHT_PROBES: Probe[] = [
  { label: "page title", selector: ".gallery__title" },
  { label: "eyebrow", selector: ".gallery__eyebrow" },
  { label: "intro", selector: ".gallery__intro" },
  { label: "section title", selector: ".rf-section__title" },
  { label: "primary button", selector: ".rf-btn--primary .rf-btn__label" },
  { label: "secondary button", selector: ".rf-btn--secondary .rf-btn__label" },
  { label: "attention button", selector: ".rf-btn--attention .rf-btn__label" },
  { label: "field label", selector: ".rf-field__label" },
  { label: "field input", selector: ".rf-field__input" },
  { label: "field help", selector: ".rf-field__help" },
  { label: "field error", selector: ".rf-field__error span" },
  { label: "metric value", selector: ".rf-metric__value" },
  { label: "metric label", selector: ".rf-metric__label" },
  { label: "table cell", selector: ".rf-table tbody td" },
  { label: "table header", selector: ".rf-table thead th" },
  { label: "status title", selector: ".rf-status__title" },
];

const INK_PROBES: Probe[] = [
  { label: "ink heading", selector: ".rf-dialog__title" },
  { label: "ink body text", selector: ".gallery__evidence > p" },
  { label: "ink formula", selector: ".gallery__formula" },
  { label: "ink footer button", selector: ".rf-dialog__foot .rf-btn__label" },
];

function parseRgb(css: string): [number, number, number] {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`unparseable color: ${css}`);
  const parts = m[1]!.split(",").map((p) => parseFloat(p));
  return [parts[0]!, parts[1]!, parts[2]!];
}

function toHex([r, g, b]: [number, number, number]): string {
  const c = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

async function effectiveColors(el: import("@playwright/test").Locator) {
  return el.evaluate((node) => {
    const fg = getComputedStyle(node).color;
    let bg = "rgba(0, 0, 0, 0)";
    let cur: HTMLElement | null = node as HTMLElement;
    while (cur) {
      const b = getComputedStyle(cur).backgroundColor;
      if (b !== "rgba(0, 0, 0, 0)" && b !== "transparent") {
        bg = b;
        break;
      }
      cur = cur.parentElement;
    }
    if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") {
      bg = getComputedStyle(document.body).backgroundColor;
    }
    const cs = getComputedStyle(node);
    return {
      fg,
      bg,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
    };
  });
}

test.describe("rendered contrast", () => {
  test("light surface text meets WCAG thresholds", async ({ page }, info) => {
    const locale = localeOf(info);
    await openGallery(page, locale);
    const failures: string[] = [];
    for (const probe of LIGHT_PROBES) {
      const el = page.locator(probe.textSelector ?? probe.selector).first();
      if (!(await el.count())) {
        failures.push(`${probe.label}: selector missing`);
        continue;
      }
      const { fg, bg, fontSize, fontWeight } = await effectiveColors(el);
      const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const min = probe.min ?? (large ? 3 : 4.5);
      const ratio = contrastRatio(toHex(parseRgb(fg)), toHex(parseRgb(bg)));
      if (ratio < min) {
        failures.push(`${probe.label}: ${ratio.toFixed(2)} < ${min} (${fg} on ${bg})`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("dark evidence surface text meets WCAG thresholds", async ({ page }, info) => {
    const locale = localeOf(info);
    await openGallery(page, locale);
    await page
      .getByRole("button", { name: copy(locale).openPanel, exact: true })
      .click();
    const dialog = page.locator('dialog[data-testid="evidence-dialog"]');
    await expect(dialog).toBeVisible();
    const failures: string[] = [];
    for (const probe of INK_PROBES) {
      const el = dialog.locator(probe.textSelector ?? probe.selector).first();
      if (!(await el.count())) {
        failures.push(`${probe.label}: selector missing`);
        continue;
      }
      const { fg, bg, fontSize, fontWeight } = await effectiveColors(el);
      const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const min = probe.min ?? (large ? 3 : 4.5);
      const ratio = contrastRatio(toHex(parseRgb(fg)), toHex(parseRgb(bg)));
      if (ratio < min) {
        failures.push(`${probe.label}: ${ratio.toFixed(2)} < ${min} (${fg} on ${bg})`);
      }
    }
    expect(failures).toEqual([]);
  });
});
