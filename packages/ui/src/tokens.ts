/**
 * Design tokens for Rowfolio — the "editorial instrument" system.
 *
 * Values mirror contracts/design-tokens.json (v1.0.0) verbatim; this module is
 * the typed TypeScript view of that wire artifact. `tokens.test.ts` asserts the
 * literals stay equal to the contract file so the two cannot drift silently.
 *
 * The palette is deliberately small and fixed by contract: paper/ink/cobalt
 * with controlled vermilion attention and functional status hues. Components
 * must not invent additional palette entries; the only permitted derivatives
 * are the documented on-ink tints below (used exclusively on the dark evidence
 * surface) whose contrast ratios are verified in `contrast.test.ts`.
 */

export const color = {
  /** Brand ink — primary text and solid primary controls. */
  ink: "#14252E",
  /** Warm paper — page background. */
  paper: "#F7F4EC",
  /** Surface — raised content regions (tables, preview panels). */
  surface: "#FFFEFA",
  /** Muted text / secondary labels on paper. */
  muted: "#53636A",
  /** Subtle rule — divider-led hierarchy. */
  rule: "#D7DCD8",
  /** Primary data cobalt — actuals, focus, links. */
  data: "#2B50E8",
  /** Cobalt at 30% on surface — non-selected marks of the observed hue. */
  dataTint30: "#C6D1FF",
  /** Vermilion — active finding / gap / attention accents. Graphical/large text only — not AA for body text. */
  attention: "#E04E1A",
  /** Negative text on light surfaces (darker than attention for AA). */
  negative: "#A33224",
  /** Positive teal — graphical/marks. */
  positive: "#0E8F7E",
  /** Positive teal, AA text grade on paper (4.9:1) — small text in the positive hue. */
  positiveText: "#116B63",
  /** Scenario amber — hypothetical series/annotations. Graphical only — not AA for body text. */
  scenario: "#B96F00",
  /** Scenario amber, AA text grade on paper (4.7:1) — hypothesis labels, notes. */
  scenarioText: "#946000",
} as const;

/**
 * On-ink tints for the dark evidence surface only. The contract palette has a
 * single theme; the evidence drawer is a dark *treatment* of it, so these are
 * lightened tints of existing tokens (matching the interaction reference),
 * never new hues. Ratios vs `color.ink` are asserted in contrast.test.ts:
 *   dataOnInk #A8BCFF on ink ≈ 8.5:1, mutedOnInk #AEC2CB on ink ≈ 8.5:1,
 *   ruleOnInk rgba-equivalent #3A4A53 on ink ≈ 1.7:1 (non-text rule only).
 */
export const colorOnInk = {
  text: "#FFFEFA",
  muted: "#AEC2CB",
  data: "#A8BCFF",
  attention: "#F0926C",
  positive: "#74C6B8",
  scenario: "#F0B45C",
  rule: "#3A4A53",
  surface: "#1E3846",
} as const;

export type ColorToken = keyof typeof color;

/** Contract spacing scale (px). Logical CSS props only — never physical. */
export const spacing = [4, 8, 12, 16, 24, 32, 48, 64, 96] as const;

export const radius = { control: 8, panel: 16, dialog: 20, pill: 999 } as const;

export const layout = {
  maxWidth: 1320,
  desktopGutter: 48,
  tabletGutter: 24,
  mobileGutter: 16,
  evidenceWidth: 560,
  /** Minimum primary control target (WCAG 2.5.8 AA is 24; design aims 44). */
  controlHeight: 44,
  chartHeightDesktop: 320,
  chartHeightMobile: 260,
} as const;

export const font = {
  latin: "IBM Plex Sans",
  arabic: "IBM Plex Sans Arabic",
  code: "IBM Plex Mono",
  /** Portable deck baseline per 06_I18N_ARABIC_SPEC.md (export only, not UI). */
  deck: "Arial",
} as const;

/** Motion durations (ms) from the contract token block. */
export const motion = {
  hoverMs: 120,
  stateMs: 160,
  panelMs: 240,
  chartMs: 220,
  staggerMs: 40,
  firstResultsMs: 180,
  numberMs: 240,
  progressMs: 120,
  reducedMs: 0,
} as const;

/** Emissive easing: cubic-bezier(0.2,0.7,0.2,1) per 05_MOTION_SPEC.md. */
export const easing = "cubic-bezier(0.2, 0.7, 0.2, 1)" as const;

/**
 * Type ramp (px) per 04_DESIGN_SYSTEM.md. Arabic uses its own scale with
 * roomier line heights; both scripts share the rhythm, not identical pixels.
 * Labels never render below 12px (web) and Arabic never below 14px in primary
 * controls — enforced via the `typeScale` literals below.
 */
export const typePx = {
  hero: 64,
  heroMobile: 42,
  page: 36,
  section: 32,
  body: 16,
  small: 13,
  metric: 40,
  metricMobile: 30,
  arabicHero: 54,
  arabicHeroMobile: 36,
  arabicSection: 30,
  arabicBody: 17,
  arabicSmall: 14,
} as const;

export const tokens = {
  color,
  colorOnInk,
  spacing,
  radius,
  layout,
  font,
  motion,
  typePx,
} as const;

export type Tokens = typeof tokens;
