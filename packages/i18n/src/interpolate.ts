import { I18nError } from "./errors.ts";

/**
 * Placeholder values are plain text only. They are interpolated into a template
 * string and the result is still plain text — never HTML. Consumers must render
 * it as text (`textContent`, React children, a native export text run); nothing
 * in this package produces markup.
 */
export type PlaceholderValue = string | number;
export type PlaceholderValues = Readonly<Record<string, PlaceholderValue>>;

const PLACEHOLDER_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Replaces every `{name}` placeholder with `params[name]`. A placeholder with no
 * supplied value is an error (`missing-placeholder`), never a silent literal;
 * extra params are ignored so callers may pass a shared bag of values.
 */
export function interpolate(template: string, params: PlaceholderValues | undefined, key: string): string {
  const missing: string[] = [];
  const out = template.replace(PLACEHOLDER_PATTERN, (whole, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null) {
      missing.push(name);
      return whole;
    }
    return String(value);
  });
  if (missing.length > 0) {
    throw new I18nError("missing-placeholder", `Message '${key}' is missing placeholder value(s): ${missing.join(", ")}`, {
      key,
      missing,
    });
  }
  return out;
}
