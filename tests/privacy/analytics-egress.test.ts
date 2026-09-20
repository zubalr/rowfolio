/**
 * Analytics egress canary — the Vercel Web Analytics beacon is the ONLY
 * permitted network emission beyond same-origin static fetches.
 *
 * 1. Source scan: no egress API call site (fetch/sendBeacon/XHR/EventSource/
 *    WebSocket) may target an absolute URL except the exact allowlisted
 *    Vercel insights/vitals endpoint prefixes.
 * 2. Unit tests on the beforeSend normalizer prove a pageview payload can
 *    never carry a query, hash content, filename, or session identifier —
 *    the emitted URL is always one of the allowlisted static route tokens.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyticsBeforeSend,
  normalizeAnalyticsUrl,
  ANALYTICS_EGRESS_ALLOWLIST,
} from "../../apps/web/src/app/analytics.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Egress API calls whose first argument is an absolute URL literal. */
const EGRESS_CALL_RE =
  /\b(?:fetch|sendBeacon|EventSource|WebSocket|importScripts)\s*\(\s*["'`](https?:\/\/|\/\/)[^"'`]*["'`]|\bopen\s*\(\s*["'`][A-Z]+["'`]\s*,\s*["'`](https?:\/\/|\/\/)[^"'`]*["'`]/g;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".vite") continue;
      yield* sourceFiles(full);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      yield full;
    }
  }
}

describe("analytics egress boundary", () => {
  it("permits only the allowlisted vercel insights/vitals endpoints as absolute egress URLs", () => {
    const violations: string[] = [];
    for (const scope of ["apps", "packages"]) {
      const dir = path.join(repoRoot, scope);
      for (const file of sourceFiles(dir)) {
        const content = readFileSync(file, "utf8");
        for (const match of content.matchAll(EGRESS_CALL_RE)) {
          const url = match[0].match(/["'`](https?:\/\/|\/\/)[^"'`]*["'`]/)?.[0] ?? "";
          const bare = url.replace(/^["'`]|["'`]$/g, "");
          if (!ANALYTICS_EGRESS_ALLOWLIST.some((p) => bare.startsWith(p))) {
            violations.push(`${path.relative(repoRoot, file)}: ${bare}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("reduces every pageview URL to an allowlisted route token", () => {
    const cases: Array<[string, string]> = [
      ["https://rowfolio.example/", "/"],
      ["https://rowfolio.example/ar/", "/ar"],
      ["https://rowfolio.example/ar", "/ar"],
      ["https://rowfolio.example/#/workspace", "/#/workspace"],
      ["https://rowfolio.example/ar#/workspace", "/ar#/workspace"],
      // identifiers must never survive
      ["https://rowfolio.example/?file=payroll.xlsx&session=abc123", "/"],
      ["https://rowfolio.example/#/workspace?row=42&file=secret.csv", "/#/workspace"],
      ["https://rowfolio.example/#/upload/payroll-2026.xlsx", "/#/"],
      ["https://rowfolio.example/ar/?q=CANARY", "/ar"],
      // non-http inputs collapse to the root token
      ["blob:https://rowfolio.example/1111-2222", "/"],
      ["not a url", "/"],
    ];
    for (const [input, expected] of cases) {
      expect(normalizeAnalyticsUrl(input)).toBe(expected);
    }
  });

  it("beforeSend emits only pageview events on allowlisted routes", () => {
    expect(
      analyticsBeforeSend({ type: "pageview", url: "https://x.test/ar/#/workspace?cell=A1" }),
    ).toEqual({ type: "pageview", url: "/ar#/workspace" });
    // custom events are never sent — pageviews only
    expect(analyticsBeforeSend({ type: "event", url: "https://x.test/" })).toBeNull();
    // a URL carrying row-level data collapses to a static token
    const sent = analyticsBeforeSend({
      type: "pageview",
      url: "https://x.test/?sheet=Q3_FINANCE&row=914&token=CANARY#/workspace",
    });
    expect(sent).not.toBeNull();
    expect(JSON.stringify(sent)).not.toContain("CANARY");
    expect(JSON.stringify(sent)).not.toContain("Q3_FINANCE");
  });

  it("keeps the egress allowlist path-scoped (insights/vitals only)", () => {
    for (const prefix of ANALYTICS_EGRESS_ALLOWLIST) {
      expect(prefix.startsWith("/_vercel/")).toBe(true);
      expect(prefix.includes("..")).toBe(false);
    }
    expect(ANALYTICS_EGRESS_ALLOWLIST).toHaveLength(2);
  });
});
