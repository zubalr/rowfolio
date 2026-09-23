/**
 * Shared helpers for the evidence visual suite.
 * Artifacts go to tests/visual/evidence/artifacts/<project>/ — generated, never committed.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import type { EvidenceScenario } from "../support/strings.ts";

export type HarnessLocale = "en" | "ar";

export function localeOf(info: TestInfo): HarnessLocale {
  return info.project.name.endsWith("-ar") ? "ar" : "en";
}

export async function openHarness(page: Page, scenario: EvidenceScenario, locale: HarnessLocale) {
  await page.goto(`/index.html?scenario=${scenario}&lang=${locale}`);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

export async function openDialog(page: Page, scenario: EvidenceScenario, locale: HarnessLocale) {
  await openHarness(page, scenario, locale);
  await page.getByTestId("open-evidence").click();
  await page.locator('dialog[data-testid="evidence-dialog"]').waitFor({ state: "visible" });
}

export function artifactPath(info: TestInfo, name: string): string {
  const dir = path.join(info.project.testDir, "..", "artifacts", info.project.name);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.png`);
}

export async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: artifactPath(info, name), fullPage: true });
}
