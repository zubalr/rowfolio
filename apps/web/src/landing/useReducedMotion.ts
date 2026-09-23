/**
 * prefers-reduced-motion as a live subscription — the controller reads the
 * callback lazily each time a dwell would arm, and the landing skips the
 * animated guide overlay entirely while the preference is set.
 */
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function snapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Non-React probe for the controller (evaluated lazily, never at import). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}
