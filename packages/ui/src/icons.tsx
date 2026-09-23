/**
 * Small, consistent Lucide-style icon subset rendered inline — 18px default,
 * stroke-width 1.75, round caps, per 04_DESIGN_SYSTEM.md.
 *
 * Geometry is drawn after Lucide (ISC License, © Lucide contributors —
 * https://lucide.dev). Keeping the handful of needed glyphs inline avoids a
 * runtime icon dependency; register additional glyphs here rather than
 * importing a second icon set.
 *
 * Directional glyphs (arrows, chevrons) set `mirror` and flip horizontally in
 * RTL via CSS; non-directional glyphs (download, chart, close, logo) never
 * mirror (06_I18N_ARABIC_SPEC.md).
 */
import type { ReactElement } from "react";
import { cx } from "./cx.ts";

export type IconName =
  | "arrow-end"
  | "check"
  | "chevron-down"
  | "close"
  | "download"
  | "info"
  | "warning"
  | "upload"
  | "table"
  | "file";

interface Glyph {
  /** SVG path/line data drawn inside the 24px Lucide grid. */
  nodes: ReactElement[];
  /** Mirror when the writing direction flips (arrows only). */
  mirror?: boolean;
}

const GLYPHS: Record<IconName, Glyph> = {
  "arrow-end": {
    mirror: true,
    nodes: [
      <line key="a" x1="5" y1="12" x2="19" y2="12" />,
      <path key="b" d="m12 5 7 7-7 7" />,
    ],
  },
  check: {
    nodes: [<path key="a" d="M20 6 9 17l-5-5" />],
  },
  "chevron-down": {
    nodes: [<path key="a" d="m6 9 6 6 6-6" />],
  },
  close: {
    nodes: [
      <path key="a" d="M18 6 6 18" />,
      <path key="b" d="m6 6 12 12" />,
    ],
  },
  download: {
    nodes: [
      <path key="a" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />,
      <path key="b" d="m7 10 5 5 5-5" />,
      <path key="c" d="M12 15V3" />,
    ],
  },
  info: {
    nodes: [
      <circle key="a" cx="12" cy="12" r="10" />,
      <path key="b" d="M12 16v-4" />,
      <path key="c" d="M12 8h.01" />,
    ],
  },
  warning: {
    nodes: [
      <path
        key="a"
        d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
      />,
      <path key="b" d="M12 9v4" />,
      <path key="c" d="M12 17h.01" />,
    ],
  },
  upload: {
    nodes: [
      <path key="a" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />,
      <path key="b" d="m17 8-5-5-5 5" />,
      <path key="c" d="M12 3v12" />,
    ],
  },
  table: {
    nodes: [
      <path key="a" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z" />,
      <path key="b" d="M3 10h18" />,
      <path key="c" d="M10 3v18" />,
    ],
  },
  file: {
    nodes: [
      <path
        key="a"
        d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
      />,
      <path key="b" d="M14 2v4a2 2 0 0 0 2 2h4" />,
      <path key="c" d="M10 9H8" />,
      <path key="d" d="M16 13H8" />,
      <path key="e" d="M16 17H8" />,
    ],
  },
};

export interface IconProps {
  name: IconName;
  /** px size; the spec subset is drawn at 18 or 20. */
  size?: 16 | 18 | 20 | 24;
  /**
   * Accessible name. Omit only when the icon is purely decorative next to a
   * visible text label — decorative icons are aria-hidden automatically.
   */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 18, label, className }: IconProps) {
  const glyph = GLYPHS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label === undefined}
      aria-label={label}
      role={label === undefined ? undefined : "img"}
      className={cx("rf-icon", glyph.mirror && "rf-icon--mirror", className)}
    >
      {glyph.nodes}
    </svg>
  );
}
