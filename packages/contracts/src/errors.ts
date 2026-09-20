/** Typed contract issues and errors. Issues are deterministic: same payload, same list. */

export type IssueCode =
  /** Structural JSON Schema (draft 2020-12 subset used by rowfolio.schema.json) failure. */
  | 'schema'
  /** Cross-field, referential-integrity or semantic refinement failure. */
  | 'semantic'
  /** Non-canonical or unsafe decimal input. */
  | 'decimal'
  /** Worker transport / binary-slot / envelope failure. */
  | 'envelope'
  /** Stale or unsupported contract/protocol version. */
  | 'version';

export interface ContractIssue {
  readonly code: IssueCode;
  /** Machine-checkable rule id, e.g. 'required', 'rowSpan.canonical', 'proof.divideByZero'. */
  readonly rule: string;
  /** JSON Pointer into the payload, e.g. '/metrics/3/value'. '' is the document root. */
  readonly path: string;
  readonly message: string;
}

export interface ValidationOk<T> {
  readonly ok: true;
  readonly value: T;
  readonly issues: readonly [];
}

export interface ValidationFailed {
  readonly ok: false;
  readonly issues: readonly ContractIssue[];
}

export type ValidationResult<T> = ValidationOk<T> | ValidationFailed;

/** Thrown by `assert*` validators; carries the full deterministic issue list. */
export class ContractError extends Error {
  readonly issues: readonly ContractIssue[];

  constructor(issues: readonly ContractIssue[]) {
    super(
      issues.length === 0
        ? 'contract validation failed'
        : issues
            .slice(0, 8)
            .map((i) => `${i.code}/${i.rule} at ${i.path || '/'}: ${i.message}`)
            .join('; ') + (issues.length > 8 ? `; …and ${issues.length - 8} more` : ''),
    );
    this.name = 'ContractError';
    this.issues = issues;
  }

  /** First issue carrying a given code, for precise test assertions. */
  firstWithCode(code: IssueCode): ContractIssue | undefined {
    return this.issues.find((i) => i.code === code);
  }
}

export function issue(code: IssueCode, rule: string, path: string, message: string): ContractIssue {
  return { code, rule, path, message };
}

/** Append helper mirroring JSON Pointer escaping. */
export function pointer(base: string, segment: string | number): string {
  const s = String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
  return `${base}/${s}`;
}

/** Short, deterministic description of a runtime value for diagnostics. */
export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length > 60 ? `string(${value.length} chars)` : JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? `number ${value}` : `nonfinite number ${String(value)}`;
  if (typeof value === 'boolean') return `boolean ${value}`;
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return `object(${Object.keys(value as object).length} keys)`;
  return typeof value;
}
