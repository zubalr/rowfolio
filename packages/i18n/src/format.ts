import type { Decimal } from "@rowfolio/contracts";
import { isDecimal, isSupportedCurrency, isValidDate } from "@rowfolio/contracts";
import { I18nError } from "./errors.ts";

/**
 * Locale-aware formatting for Rowfolio.
 *
 * All numeric entry points accept contract `Decimal` strings (finite,
 * non-exponent, no negative zero) or finite numbers. Rendering is display-only:
 * the decimal string is split into integer/fraction digits exactly, the integer
 * is grouped through `BigInt` (arbitrary precision, no double rounding), the
 * fraction is emitted verbatim, and sign/percent/currency placement comes from
 * `Intl.NumberFormat.prototype.formatToParts` of a probe value. Display
 * truncation, when requested via fraction-digit options, uses ROUND_HALF_UP per
 * `contracts/policy.json`. Nothing here ever rewrites a stored value.
 */

export type NumberingSystem = "latn" | "arab";
export type DateStyle = "full" | "long" | "medium" | "short";

export interface NumberFormatOptions {
  /** Show exactly this many fraction digits (zero-pads; HALF_UP-rounds when the input has more). */
  scale?: number;
  minFractionDigits?: number;
  maxFractionDigits?: number;
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
  useGrouping?: boolean;
}

export interface CurrencyFormatOptions extends NumberFormatOptions {
  currencyDisplay?: "symbol" | "narrowSymbol" | "code" | "name";
}

export interface DateFormatOptions {
  dateStyle?: DateStyle;
}

export interface MonthFormatOptions {
  month?: "long" | "short" | "narrow" | "numeric";
  year?: "numeric" | "2-digit";
}

export interface ListFormatOptions {
  type?: "conjunction" | "disjunction" | "unit";
  style?: "long" | "short" | "narrow";
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const MAX_FRACTION_DIGITS = 100;

/**
 * Validates a contract decimal string. Delegates to `isDecimal` from
 * `@rowfolio/contracts` — the wire authority (finite decimal, no exponent
 * notation, no negative zero, length bound) — and raises a typed `I18nError`.
 */
export function assertDecimal(value: string): Decimal {
  if (!isDecimal(value)) {
    throw new I18nError("invalid-decimal", `Not a finite canonical decimal: ${JSON.stringify(value)}`, {
      value,
    });
  }
  return value;
}

/** Coerces a `Decimal | number` input into a validated canonical decimal string. */
export function toDecimal(value: Decimal | number): Decimal {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new I18nError("invalid-decimal", `Non-finite number cannot be formatted: ${String(value)}`, {
        value: String(value),
      });
    }
    if (Object.is(value, -0)) {
      throw new I18nError("invalid-decimal", "Negative zero is not a canonical decimal", { value: "-0" });
    }
    let text = String(value);
    if (/[eE]/.test(text)) {
      if (!Number.isSafeInteger(value)) {
        throw new I18nError(
          "invalid-decimal",
          `Number ${text} uses exponent notation and is not a safe integer; pass a decimal string for exact display`,
          { value: text },
        );
      }
      text = value.toFixed(0);
    }
    return assertDecimal(text);
  }
  return assertDecimal(value);
}

interface DecimalParts {
  negative: boolean;
  integer: string;
  fraction: string;
}

function splitDecimal(decimal: Decimal): DecimalParts {
  const negative = decimal.startsWith("-");
  const body = negative ? decimal.slice(1) : decimal;
  const dot = body.indexOf(".");
  return {
    negative,
    integer: dot === -1 ? body : body.slice(0, dot),
    fraction: dot === -1 ? "" : body.slice(dot + 1),
  };
}

function isZeroParts(parts: DecimalParts): boolean {
  return /^0*$/.test(parts.integer) && /^0*$/.test(parts.fraction);
}

function incrementDigits(digits: string): string {
  const chars = digits.split("");
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    if (chars[i] !== "9") {
      chars[i] = String.fromCharCode(chars[i]!.charCodeAt(0) + 1);
      return chars.join("");
    }
    chars[i] = "0";
  }
  return `1${chars.join("")}`;
}

/**
 * Applies display fraction bounds. Truncation rounds HALF_UP at the digit level
 * (the declared policy rounding) and can carry into the integer part; padding
 * appends exact zeros. Input digits themselves are never altered otherwise.
 */
function applyFractionBounds(parts: DecimalParts, min: number, max: number): DecimalParts {
  let { integer, fraction } = parts;
  if (fraction.length > max) {
    const roundUp = fraction.charCodeAt(max) >= 53; // '5'
    fraction = fraction.slice(0, max);
    if (roundUp) {
      const combined = incrementDigits(integer + fraction);
      const splitAt = combined.length - max;
      integer = splitAt > 0 ? combined.slice(0, splitAt) : "0";
      fraction = max > 0 ? combined.slice(splitAt) : "";
    }
  }
  if (fraction.length < min) {
    fraction = fraction.padEnd(min, "0");
  }
  return { negative: parts.negative, integer, fraction };
}

/** Multiplies by 100 exactly by moving the decimal point — percent display shifts digits, never values. */
function shiftForPercent(parts: DecimalParts): DecimalParts {
  const digits = parts.integer + parts.fraction;
  // Decimal point moves two places right; pad so the split point exists.
  const point = parts.integer.length + 2;
  const padded = digits.padStart(point, "0");
  const integer = padded.slice(0, point).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(point);
  return { negative: parts.negative, integer, fraction };
}

interface FractionBounds {
  min: number;
  max: number;
}

function fractionBounds(options: NumberFormatOptions | undefined): FractionBounds {
  const scale = options?.scale;
  const min = options?.minFractionDigits ?? scale ?? 0;
  const max = options?.maxFractionDigits ?? scale ?? MAX_FRACTION_DIGITS;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 0 || min > max || max > MAX_FRACTION_DIGITS) {
    throw new I18nError("invalid-decimal", `Invalid fraction-digit bounds min=${min} max=${max}`, { min, max });
  }
  return { min, max };
}

function currencyCode(currency: string): string {
  const code = currency.toUpperCase();
  if (!isSupportedCurrency(code)) {
    throw new I18nError("invalid-currency", `Unsupported currency code: ${JSON.stringify(currency)}`, {
      currency,
    });
  }
  return code;
}

function parseIsoDate(isoDate: string): Date {
  // isValidDate (contracts) enforces ISO shape + a real Gregorian day.
  if (!isValidDate(isoDate)) {
    throw new I18nError("invalid-date", `Expected a real ISO Gregorian date 'YYYY-MM-DD', got ${JSON.stringify(isoDate)}`, {
      value: isoDate,
    });
  }
  const match = ISO_DATE_PATTERN.exec(isoDate)!;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function parseIsoMonth(period: string): Date {
  const match = ISO_MONTH_PATTERN.exec(period);
  if (match === null || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new I18nError("invalid-date", `Expected ISO month 'YYYY-MM', got ${JSON.stringify(period)}`, {
      value: period,
    });
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

export interface Formatters {
  formatNumber(value: Decimal | number, options?: NumberFormatOptions): string;
  formatInteger(value: Decimal | number): string;
  formatPercent(value: Decimal | number, options?: NumberFormatOptions): string;
  formatCurrency(value: Decimal | number, currency: string, options?: CurrencyFormatOptions): string;
  formatDate(isoDate: string, options?: DateFormatOptions): string;
  formatMonth(period: string, options?: MonthFormatOptions): string;
  formatDateRange(startIsoDate: string, endIsoDate: string, options?: DateFormatOptions): string;
  formatList(items: readonly string[], options?: ListFormatOptions): string;
}

/**
 * Builds the formatter set for one resolved Intl locale tag (e.g.
 * `en-US-u-nu-latn`, `ar-QA-u-nu-arab`). Instances are cheap and stateless;
 * Intl objects are memoized internally per option shape.
 */
export function createFormatters(localeTag: string): Formatters {
  // If the tag requests a numbering system the platform does not honor, fail
  // loudly rather than silently emitting the wrong digit script.
  const nuMatch = /-u-nu-([a-z0-9-]+)/i.exec(localeTag);
  if (nuMatch !== null) {
    const resolved = new Intl.NumberFormat(localeTag).resolvedOptions().numberingSystem;
    if (resolved !== nuMatch[1]!.toLowerCase()) {
      throw new I18nError(
        "invalid-numbering-system",
        `Numbering system '${nuMatch[1]}' not honored (resolved '${resolved}')`,
        { numberingSystem: nuMatch[1] },
      );
    }
  }
  const numberCache = new Map<string, Intl.NumberFormat>();
  const dateCache = new Map<string, Intl.DateTimeFormat>();
  const listCache = new Map<string, Intl.ListFormat>();
  // ASCII → locale digit map (fraction digits are emitted verbatim, so they
  // must pass through the numbering system explicitly).
  const digitMap: readonly string[] = (() => {
    const nf = new Intl.NumberFormat(localeTag, { useGrouping: false });
    return Array.from({ length: 10 }, (_, d) => nf.format(d));
  })();
  const localizeDigits = (digits: string): string =>
    digits.replace(/[0-9]/g, (d) => digitMap[d.charCodeAt(0) - 48]!);

  function numberFormat(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
    const existing = numberCache.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Intl.NumberFormat(localeTag, options);
    numberCache.set(key, created);
    return created;
  }

  function dateFormat(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const existing = dateCache.get(key);
    if (existing !== undefined) {
      return existing;
    }
      const created = new Intl.DateTimeFormat(localeTag, { ...options, calendar: "gregory", timeZone: "UTC" });
    dateCache.set(key, created);
    return created;
  }

  /**
   * Emits the exact digit content inside the locale's own scaffolding. The
   * probe value is chosen so every part type we may need (sign, integer+group,
   * decimal+fraction, percent/currency, literal bidi marks) is present in the
   * parts list; our digits replace only the digit parts.
   */
  function renderDigits(
    parts: DecimalParts,
    intlOptions: Intl.NumberFormatOptions,
    cacheKey: string,
  ): string {
    const signDisplay = (intlOptions.signDisplay ?? "auto") as string;
    const wantsNegativeProbe = parts.negative && signDisplay !== "never";
    // 1.2345 keeps a non-zero fraction under every style (percent turns 1.5
    // into 150% — an integer, which would drop the decimal slot entirely).
    const probe = wantsNegativeProbe ? -1.2345 : 1.2345;
    // The probe must surface a fraction slot under every style: percent's
    // default maximumFractionDigits is 0, which would render it integer-only.
    const nf = numberFormat(`${cacheKey}:probe`, { ...intlOptions, minimumFractionDigits: 4 });

    const groupingNf = numberFormat(`digits:${intlOptions.useGrouping ?? "auto"}`, {
      style: "decimal",
      ...(intlOptions.useGrouping !== undefined ? { useGrouping: intlOptions.useGrouping } : {}),
    });
    const groupedInteger = groupingNf.format(BigInt(parts.integer));

    const suppressSign = isZeroParts(parts) && (signDisplay === "exceptZero" || signDisplay === "never");
    let out = "";
    let integerEmitted = false;
    for (const part of nf.formatToParts(probe)) {
      switch (part.type) {
        case "integer":
          if (!integerEmitted) {
            out += groupedInteger;
            integerEmitted = true;
          }
          break;
        case "group":
          break;
        case "decimal":
          if (parts.fraction.length > 0) {
            out += part.value;
          }
          break;
        case "fraction":
          if (parts.fraction.length > 0) {
            out += localizeDigits(parts.fraction);
          }
          break;
        case "minusSign":
        case "plusSign":
          if (!suppressSign) {
            out += part.value;
          }
          break;
        default:
          out += part.value;
          break;
      }
    }
    return out;
  }

  function formatNumber(value: Decimal | number, options?: NumberFormatOptions): string {
    const bounds = fractionBounds(options);
    const parts = applyFractionBounds(splitDecimal(toDecimal(value)), bounds.min, bounds.max);
    const intlOptions: Intl.NumberFormatOptions = {
      style: "decimal",
      ...(options?.signDisplay !== undefined ? { signDisplay: options.signDisplay } : {}),
      ...(options?.useGrouping !== undefined ? { useGrouping: options.useGrouping } : {}),
    };
    return renderDigits(parts, intlOptions, `decimal:${JSON.stringify(intlOptions)}`);
  }

  function formatInteger(value: Decimal | number): string {
    const parts = splitDecimal(toDecimal(value));
    if (!/^0*$/.test(parts.fraction)) {
      throw new I18nError("invalid-decimal", `Expected an integer value, got ${value}`, { value: String(value) });
    }
    return renderDigits({ negative: parts.negative, integer: parts.integer, fraction: "" }, { style: "decimal" }, "integer");
  }

  function formatPercent(value: Decimal | number, options?: NumberFormatOptions): string {
    const bounds = fractionBounds(options);
    const shifted = shiftForPercent(splitDecimal(toDecimal(value)));
    const parts = applyFractionBounds(shifted, bounds.min, bounds.max);
    const intlOptions: Intl.NumberFormatOptions = {
      style: "percent",
      ...(options?.signDisplay !== undefined ? { signDisplay: options.signDisplay } : {}),
      ...(options?.useGrouping !== undefined ? { useGrouping: options.useGrouping } : {}),
    };
    return renderDigits(parts, intlOptions, `percent:${JSON.stringify(intlOptions)}`);
  }

  function formatCurrency(value: Decimal | number, currency: string, options?: CurrencyFormatOptions): string {
    const code = currencyCode(currency);
    const bounds = fractionBounds(options);
    const parts = applyFractionBounds(splitDecimal(toDecimal(value)), bounds.min, bounds.max);
    const intlOptions: Intl.NumberFormatOptions = {
      style: "currency",
      currency: code,
      ...(options?.currencyDisplay !== undefined ? { currencyDisplay: options.currencyDisplay } : {}),
      ...(options?.signDisplay !== undefined ? { signDisplay: options.signDisplay } : {}),
      ...(options?.useGrouping !== undefined ? { useGrouping: options.useGrouping } : {}),
    };
    return renderDigits(parts, intlOptions, `currency:${code}:${JSON.stringify(intlOptions)}`);
  }

  function formatDate(isoDate: string, options?: DateFormatOptions): string {
    const date = parseIsoDate(isoDate);
    const style = options?.dateStyle ?? "medium";
    return dateFormat(`date:${style}`, { dateStyle: style }).format(date);
  }

  function formatMonth(period: string, options?: MonthFormatOptions): string {
    const date = parseIsoMonth(period);
    const month = options?.month ?? "short";
    const year = options?.year ?? "numeric";
    return dateFormat(`month:${month}:${year}`, { month, year }).format(date);
  }

  function formatDateRange(startIsoDate: string, endIsoDate: string, options?: DateFormatOptions): string {
    const start = parseIsoDate(startIsoDate);
    const end = parseIsoDate(endIsoDate);
    if (end.getTime() < start.getTime()) {
      throw new I18nError("invalid-date", `Date range start after end: ${startIsoDate} > ${endIsoDate}`, {
        start: startIsoDate,
        end: endIsoDate,
      });
    }
    const style = options?.dateStyle ?? "medium";
    return dateFormat(`date:${style}`, { dateStyle: style }).formatRange(start, end);
  }

  function formatList(items: readonly string[], options?: ListFormatOptions): string {
    const type = options?.type ?? "conjunction";
    const style = options?.style ?? "long";
    const key = `list:${type}:${style}`;
    const existing = listCache.get(key);
    const nf = existing ?? new Intl.ListFormat(localeTag, { type, style });
    if (existing === undefined) {
      listCache.set(key, nf);
    }
    return nf.format(items.slice());
  }

  return {
    formatNumber,
    formatInteger,
    formatPercent,
    formatCurrency,
    formatDate,
    formatMonth,
    formatDateRange,
    formatList,
  };
}
