/**
 * @rowfolio/ui — art-directed, direction-aware primitives for Rowfolio.
 *
 * One light theme on paper/ink/cobalt tokens with a scoped dark evidence
 * surface. Components are presentation-only: they accept localized strings,
 * formatted values and contract types through props and never recompute
 * business truth.
 *
 * Global foundation CSS (tokens + base) loads with this entry. Load fonts once
 * per app entry via `import "@rowfolio/ui/fonts"`.
 */
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

export { tokens, color, colorOnInk, spacing, radius, layout, font, motion, easing, typePx } from "./tokens.ts";
export type { ColorToken, Tokens } from "./tokens.ts";

export { contrastRatio, relativeLuminance, srgbChannel, checkedPairs, UiColorError } from "./contrast.ts";
export type { ContrastPair } from "./contrast.ts";

export { directionOf, isRtl } from "./direction.ts";
export type { LocaleCode, WritingDirection } from "./direction.ts";

export { cx } from "./cx.ts";

export { Icon } from "./icons.tsx";
export type { IconName, IconProps } from "./icons.tsx";

export { Button, UiPrimitiveError } from "./primitives/Button.tsx";
export type { ButtonProps } from "./primitives/Button.tsx";

export { Field } from "./primitives/Field.tsx";
export type { FieldProps } from "./primitives/Field.tsx";

export { Section } from "./primitives/Section.tsx";
export type { SectionProps } from "./primitives/Section.tsx";

export { Dialog } from "./primitives/Dialog.tsx";
export type { DialogProps } from "./primitives/Dialog.tsx";

export { Status } from "./primitives/Status.tsx";
export type { StatusKind, StatusProps, StatusStage } from "./primitives/Status.tsx";

export { DataTable } from "./primitives/DataTable.tsx";
export type { DataTableColumn, DataTableProps, DataTableRow } from "./primitives/DataTable.tsx";

export { Metric, MetricStrip, MetricContractError } from "./primitives/Metric.tsx";
export type { MetricDelta, MetricProps, MetricStripProps } from "./primitives/Metric.tsx";

export { Bidi, SkipLink, VisuallyHidden } from "./primitives/assist.tsx";
export type { BidiProps, SkipLinkProps } from "./primitives/assist.tsx";
