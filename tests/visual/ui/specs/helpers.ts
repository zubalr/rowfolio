/**
 * Shared helpers for the @rowfolio/ui visual suite.
 * Artifacts go to tests/visual/ui/artifacts/<project>/ — generated, never
 * committed. Fixture strings come from the gallery itself so selectors always
 * match the rendered copy verbatim.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { strings, type GalleryLocale } from "../../../../packages/ui/gallery/fixtures.ts";

export type { GalleryLocale };

export function localeOf(info: TestInfo): GalleryLocale {
  return info.project.name.endsWith("-ar") ? "ar" : "en";
}

export function copy(locale: GalleryLocale) {
  return strings[locale];
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
