/**
 * Route helpers for the static landing entries.
 *
 * Both static entries (`/` English, `/ar/` Arabic) render the landing; the
 * workspace is a client-rendered hash route on the same entry
 * (`#/workspace`, per apps/web/vite.config.ts). Everything here is a
 * function — no `window` access at module scope, so the modules stay safe
 * for build-time prerendering.
 */
import type { Locale } from "@rowfolio/contracts";

export const WORKSPACE_ROUTE = "#/workspace";

/** Sibling static entry for the in-page language switch. */
export function siblingLocaleHref(locale: Locale): string {
  return locale === "ar" ? "/" : "/ar/";
}

/** Navigate to the workspace route on the current locale entry. */
export function workspaceHref(): string {
  return WORKSPACE_ROUTE;
}

export function navigateToWorkspace(): void {
  window.location.hash = WORKSPACE_ROUTE;
}

export function scrollToId(id: string): void {
  const el = document.getElementById(id);
  if (el === null) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" });
}

export function focusById(id: string): void {
  const el = document.getElementById(id);
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
}
