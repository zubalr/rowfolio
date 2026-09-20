/**
 * Shared finding/report types for the independent test inspectors
 * (tooling/test). These modules deliberately use only Node builtins and
 * never import the packages under test — they are a second implementation
 * whose verdicts are cross-checked against the real contract validators in
 * tests/helpers/*.test.ts.
 */

export type Severity = 'error' | 'warning';

export interface Finding {
  /** Stable machine-readable code, e.g. "zip.crc-mismatch". */
  code: string;
  severity: Severity;
  /** Archive entry or document path the finding refers to, when relevant. */
  path?: string;
  /** Human-readable detail. Never carries source cell/business values. */
  detail: string;
}

export const finding = (code: string, severity: Severity, detail: string, path?: string): Finding =>
  path === undefined ? { code, severity, detail } : { code, severity, detail, path };

export const hasErrors = (findings: readonly Finding[]): boolean =>
  findings.some((f) => f.severity === 'error');

export const codesOf = (findings: readonly Finding[]): string[] => findings.map((f) => f.code);

export const hasCode = (findings: readonly Finding[], code: string): boolean =>
  findings.some((f) => f.code === code);
