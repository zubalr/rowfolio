/**
 * Shared helpers for the @rowfolio/charts visual suite.
 * Artifacts go to tests/visual/charts/artifacts/<project>/ — generated, never
 * committed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

export type GalleryLocale = "en" | "ar";

export function localeOf(info: TestInfo): GalleryLocale {
  return info.project.name.endsWith("-ar") ? "ar" : "en";
}

export async function openGallery(page: Page, locale: GalleryLocale) {
  await page.goto(`/?lang=${locale}`);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

export function artifactPath(info: TestInfo, name: string): string {
  const dir = path.join(info.project.testDir, "..", "artifacts", info.project.name);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.png`);
}

export async function shot(
  page: Page,
  info: TestInfo,
  name: string,
  options: { fullPage?: boolean } = {},
) {
  await page.screenshot({
    path: artifactPath(info, name),
    fullPage: options.fullPage ?? true,
  });
}

/** The fixture chart cards, in document order. */
export function story(page: Page, name: string) {
  return page.locator(`[data-story="${name}"]`);
}
