/**
 * Typed errors for @rowfolio/i18n.
 *
 * Every failure raised by this package is an {@link I18nError} carrying a stable
 * machine-readable `code`. UI layers map codes to the localized `error.*` copy
 * keys and must never show raw internal messages or cell contents to the user.
 */
export type I18nErrorCode =
  | "invalid-catalog"
  | "catalog-mismatch"
  | "unknown-key"
  | "missing-placeholder"
  | "invalid-locale"
  | "invalid-numbering-system"
  | "invalid-decimal"
  | "invalid-count"
  | "invalid-date"
  | "invalid-currency"
  | "invalid-number"
  | "ambiguous-number";

export class I18nError extends Error {
  readonly code: I18nErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: I18nErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "I18nError";
    this.code = code;
    this.details = details === undefined ? undefined : Object.freeze({ ...details });
  }
}

export function isI18nError(error: unknown): error is I18nError {
  return error instanceof I18nError;
}
