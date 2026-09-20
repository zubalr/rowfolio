import { expect, type Page, type Request, type TestInfo } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ARTIFACTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../artifacts",
);

/** Locale-aware landing entry: tests run against the built static entries. */
export function entryUrl(testInfo: TestInfo): string {
  const locale = testInfo.project.use.locale ?? "en-US";
  return locale.startsWith("ar") ? "/ar/" : "/";
}

export interface NetworkLog {
  readonly requests: Request[];
}

/** Record every request the page makes for the zero-network assertion. */
export function recordNetwork(page: Page): NetworkLog {
  const log: NetworkLog = { requests: [] };
  page.on("request", (r) => log.requests.push(r));
  return log;
}

/**
 * Rowfolio is fully local: every request must be a same-origin static GET —
 * no XHR/fetch leaves the page, no telemetry/beacon, no POST/PUT, nothing
 * off-origin (fonts are self-hosted woff/woff2).
 */
export function expectLocalOnly(log: NetworkLog, baseURL: string | undefined): void {
  const origin = new URL(baseURL ?? "http://127.0.0.1:4533").origin;
  const violations = log.requests.filter((r) => {
    const url = r.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;
    if (!url.startsWith(origin)) return true;
    return r.method() !== "GET";
  });
  const interesting = log.requests.filter(
    (r) => r.resourceType() === "xhr" || r.resourceType() === "fetch" || r.resourceType() === "websocket" || r.resourceType() === "eventsource",
  );
  expect(
    violations.map((r) => `${r.method()} ${r.url()}`),
    "off-origin or non-GET requests",
  ).toEqual([]);
  expect(
    interesting.map((r) => r.url()),
    "xhr/fetch/ws/sse requests",
  ).toEqual([]);
}

/** Storyboard dwells in ms (intro/findings/evidence/scenario/briefing/complete). */
export const GUIDE_DWELL_MS = [4000, 6000, 7000, 7000, 8000, 6000] as const;
