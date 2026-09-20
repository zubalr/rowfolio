import type { BeforeSend, BeforeSendEvent } from "@vercel/analytics/react";

/**
 * Vercel Web Analytics — pageviews only, production only.
 *
 * The beacon ships a URL string; this module reduces it to an allowlisted
 * route token so no query, hash payload, filename, or session identifier can
 * ever leave the browser. Anything outside the allowlist collapses to `/`.
 */
const ALLOWED_PATHS = new Set(["/", "/ar"]);
const ALLOWED_HASHES = new Set(["", "#/", "#/workspace"]);

export const ANALYTICS_EGRESS_ALLOWLIST = [
  "/_vercel/insights",
  "/_vercel/vitals",
] as const;

export function normalizeAnalyticsUrl(raw: string): string {
  try {
    const url = new URL(raw, "https://rowfolio.invalid");
    const path = url.pathname.startsWith("/ar") ? "/ar" : "/";
    const hash = url.hash.startsWith("#/workspace") ? "#/workspace" : url.hash.startsWith("#/") ? "#/" : "";
    const token = `${path}${hash}`;
    if (!ALLOWED_PATHS.has(path) || !ALLOWED_HASHES.has(hash)) return "/";
    return token;
  } catch {
    return "/";
  }
}

export const analyticsBeforeSend: BeforeSend = (event: BeforeSendEvent) => {
  if (event.type !== "pageview") return null;
  return { type: "pageview", url: normalizeAnalyticsUrl(event.url) };
};

/**
 * Analytics mounts only on Vercel production builds — never dev, preview, or
 * other hosts. Evaluated with import.meta.env inline so non-Vercel builds
 * constant-fold the gate and tree-shake the package out of the entry chunk.
 */
export function analyticsEnabled(): boolean {
  const vercelEnv = import.meta.env.VITE_VERCEL_ENV as string | undefined;
  return import.meta.env.PROD && vercelEnv === "production";
}
