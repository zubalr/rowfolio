/**
 * Viewport hooks: measured container width and reduced-motion preference.
 * Width drives real-pixel geometry so labels never shrink below the type
 * scale — charts recompute layout rather than scaling text down.
 */
import { useEffect, useRef, useState } from "react";

/** Debounced content-box width of the referenced element. */
export function useMeasure<T extends HTMLElement>(fallbackWidth = 640) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallbackWidth);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect.width;
      if (box === undefined) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(Math.max(0, Math.round(box))));
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return { ref, width };
}

/** Live `prefers-reduced-motion` match. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
