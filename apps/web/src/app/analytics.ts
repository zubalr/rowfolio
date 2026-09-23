import type { BeforeSend, BeforeSendEvent } from "@vercel/analytics";

/**
 * Vercel Web Analytics — pageviews only, production only.
 *
 * The beacon ships a URL string; this module reduces it to the page origin
 * plus an allowlisted route so no query, hash payload, filename, or session
 * identifier can ever leave the browser. Anything outside the allowlist
 * collapses to the bare origin root, and non-http inputs are dropped — the
 * collector requires absolute `https?://` URLs.
 */
const ALLOWED_PATHS = new Set(["/", "/ar"]);
const ALLOWED_HASHES = new Set(["", "#/", "#/workspace"]);

export const ANALYTICS_EGRESS_ALLOWLIST = [
  "/_vercel/insights",
  "/_vercel/vitals",
] as const;

export function normalizeAnalyticsUrl(raw: string): string | null {
  try {
    const url = new URL(raw, "https://rowfolio.invalid");
    if (!/^https?:$/.test(url.protocol) || url.host === "rowfolio.invalid") return null;
    const path = url.pathname.startsWith("/ar") ? "/ar" : "/";
    const hash = url.hash.startsWith("#/workspace") ? "#/workspace" : url.hash.startsWith("#/") ? "#/" : "";
    if (!ALLOWED_PATHS.has(path) || !ALLOWED_HASHES.has(hash)) return `${url.origin}/`;
    return `${url.origin}${path}${hash}`;
  } catch {
    return null;
  }
}

export const analyticsBeforeSend: BeforeSend = (event: BeforeSendEvent) => {
  if (event.type !== "pageview") return null;
  const url = normalizeAnalyticsUrl(event.url);
  return url === null ? null : { type: "pageview", url };
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
