/**
 * GuideHighlight — the traveling focus ring for the guided demo.
 *
 * Lazy-loaded: this is the ONLY module in the landing graph that imports
 * Motion (`motion/react`), keeping the entry chunk free of the animation
 * library (landing-chunk bundle audit). It renders a fixed overlay ring
 * around the element marked `data-demo-target="<step>"` and animates its
 * transform between steps — the explanatory "look here now" transition.
 * Never rendered under reduced motion; CSS `data-demo-active` outlines are
 * the instant fallback there.
 */
import { useEffect, useState } from "react";
import { motion } from "motion/react";

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function measure(stepId: string): Rect | null {
  const el = document.querySelector<HTMLElement>(`[data-demo-target="${stepId}"]`);
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  const inset = 6;
  return { x: r.left - inset, y: r.top - inset, width: r.width + inset * 2, height: r.height + inset * 2 };
}

export default function GuideHighlight({ stepId }: { stepId: string }) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    const update = () => setRect(measure(stepId));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [stepId]);

  if (rect === null) return null;
  return (
    <motion.div
      aria-hidden="true"
      className="rf-demo-ring"
      initial={false}
      animate={{
        transform: `translate(${rect.x}px, ${rect.y}px)`,
        width: rect.width,
        height: rect.height,
        opacity: 1,
      }}
      transition={{ duration: 0.32, ease: [0.2, 0.7, 0.2, 1] }}
    />
  );
}
