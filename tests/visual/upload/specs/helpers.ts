/**
 * Shared helpers for the upload visual suite.
 * Artifacts go to tests/visual/upload/artifacts/<project>/ — generated, never
 * committed. Real fixture bytes come from fixtures/ingest/generated (hashes in
 * the repo manifest); inline CSVs are built per test.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, TestInfo } from "@playwright/test";

export type HarnessLocale = "en" | "ar";

export function localeOf(info: TestInfo): HarnessLocale {
  return info.project.name.endsWith("-ar") ? "ar" : "en";
}

const FIXTURES = fileURLToPath(
  new URL("../../../../fixtures/ingest/generated", import.meta.url),
);

export function fixturePath(name: string): string {
  return path.join(FIXTURES, name);
}

export async function openHarness(page: Page, locale: HarnessLocale) {
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

/** Feed a file through the real <input type=file>. */
export async function feed(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer } | string,
) {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(file);
}
