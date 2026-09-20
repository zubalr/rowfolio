/**
 * Design tokens — a versioned contract constant (source/design-tokens.json).
 * The UI package consumes these; contracts owns the canonical copy so all
 * consumers read one artifact.
 */
import designTokens from '../source/design-tokens.json';

export type DesignTokens = typeof designTokens;

export const DESIGN_TOKENS: DesignTokens = designTokens;
