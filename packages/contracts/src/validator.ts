/**
 * Deterministic JSON Schema (draft 2020-12) validator covering exactly the
 * keyword subset used by rowfolio.schema.json and its wrapper documents:
 *
 *   $ref · $defs · $id (registry) · type (single or list) · enum · const ·
 *   oneOf · anyOf · allOf · properties · required · additionalProperties ·
 *   items · minItems · maxItems · minLength · maxLength · pattern ·
 *   minimum · maximum · format(date-time)
 *
 * The registry is the checked-in source/ documents; `.invalid` $ids are
 * identifiers only and are never fetched — resolution is fully offline
 * (INTERFACES.md). Unknown keywords are ignored (annotations), matching
 * draft 2020-12.
 */
import { describeValue, issue, pointer, type ContractIssue } from './errors.ts';

export type SchemaNode = Record<string, unknown> | boolean;

export interface SchemaRegistry {
  /** basename → document, e.g. 'rowfolio.schema.json'. */
  readonly byName: ReadonlyMap<string, Record<string, unknown>>;
  /** absolute $id → document. */
  readonly byId: ReadonlyMap<string, Record<string, unknown>>;
}

export function createRegistry(documents: readonly Record<string, unknown>[]): SchemaRegistry {
  const byName = new Map<string, Record<string, unknown>>();
  const byId = new Map<string, Record<string, unknown>>();
  for (const doc of documents) {
    const id = doc['$id'];
    if (typeof id === 'string') {
      byId.set(id, doc);
      const base = id.split('/').pop();
      if (base !== undefined) byName.set(base, doc);
    }
  }
  return { byName, byId };
}

const TYPE_NAMES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array']);

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value; // string | boolean | object
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** RFC 3339 date-time with a real Gregorian date (rejects 2026-02-30, hour 24, bad offsets). */
export function isValidDateTime(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (m === null) return false;
  const [, y, mo, d, h, mi, s, , zone] = m;
  if (!isRealDate(Number(y), Number(mo), Number(d))) return false;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 60) return false; // 60 admits the RFC 3339 leap second
  if (zone !== undefined && zone !== 'Z' && zone !== 'z') {
    const [zh, zm] = zone.slice(1).split(':').map(Number);
    if (zh === undefined || zm === undefined || zh > 23 || zm > 59) return false;
  }
  return true;
}

/** ISO `YYYY-MM-DD` calendar date that is a real Gregorian date. */
export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m !== null && isRealDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysIn = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= daysIn;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export class SchemaValidator {
  private readonly registry: SchemaRegistry;
  /** Document that bare `#/...` refs resolve against. */
  private currentDoc: Record<string, unknown>;

  constructor(registry: SchemaRegistry, baseDocument: Record<string, unknown>) {
    this.registry = registry;
    this.currentDoc = baseDocument;
  }

  /** Validate `value` against `schema`; returns a deterministic issue list (empty = valid). */
  check(schema: SchemaNode, value: unknown, path = '', refPath = '#'): ContractIssue[] {
    const issues: ContractIssue[] = [];
    this.checkNode(schema, value, path, refPath, issues);
    return issues;
  }

  private resolvePointer(doc: Record<string, unknown>, fragment: string): SchemaNode | null {
    if (fragment === '') return doc;
    if (!fragment.startsWith('/')) return null; // only JSON Pointers are used in this registry
    let node: unknown = doc;
    for (const raw of fragment.slice(1).split('/')) {
      const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!isPlainObject(node) || !(seg in node)) return null;
      node = node[seg];
    }
    if (!isPlainObject(node) && typeof node !== 'boolean') return null;
    return node as SchemaNode;
  }

  private checkNode(schema: SchemaNode, value: unknown, path: string, refPath: string, issues: ContractIssue[]): void {
    if (typeof schema === 'boolean') {
      if (!schema) issues.push(issue('schema', 'false', path, `value ${describeValue(value)} rejected by boolean schema false`));
      return;
    }
    if (!isPlainObject(schema)) return;

    const ref = schema['$ref'];
    if (typeof ref === 'string') {
      const hash = ref.indexOf('#');
      const docName = hash === -1 ? ref : ref.slice(0, hash);
      const fragment = hash === -1 ? '' : ref.slice(hash + 1);
      const target = docName === '' ? this.currentDoc : (this.registry.byName.get(docName) ?? this.registry.byId.get(docName));
      if (target === undefined) {
        issues.push(issue('schema', '$ref', path, `unresolvable schema reference ${JSON.stringify(ref)}`));
        return;
      }
      const node = this.resolvePointer(target, fragment);
      if (node === null) {
        issues.push(issue('schema', '$ref', path, `unresolvable fragment ${JSON.stringify(ref)}`));
        return;
      }
      const prevDoc = this.currentDoc;
      this.currentDoc = target;
      this.checkNode(node, value, path, `${refPath}<${ref}>`, issues);
      this.currentDoc = prevDoc;
      return; // $ref is the sole applicator in this registry's documents
    }

    // --- type ---
    const t = schema['type'];
    if (t !== undefined) {
      const allowed = Array.isArray(t) ? t : [t];
      const ok = allowed.some((name) => {
        if (!TYPE_NAMES.has(name as string)) return false;
        const actual = typeOf(value);
        return name === 'number'
          ? actual === 'number' || actual === 'integer'
          : name === 'object'
            ? isPlainObject(value)
            : name === 'array'
              ? Array.isArray(value)
              : actual === name;
      });
      if (!ok) {
        issues.push(issue('schema', 'type', path, `expected ${(allowed as unknown[]).join(' | ')}, got ${describeValue(value)}`));
        return; // downstream keywords are meaningless on the wrong type
      }
    }

    // --- const / enum ---
    if ('const' in schema && !deepEqual(value, schema['const'])) {
      issues.push(issue('schema', 'const', path, `expected constant ${describeValue(schema['const'])}, got ${describeValue(value)}`));
    }
    if (Array.isArray(schema['enum']) && !schema['enum'].some((v) => deepEqual(v, value))) {
      issues.push(issue('schema', 'enum', path, `${describeValue(value)} not in enum`));
    }

    // --- combinators ---
    if (Array.isArray(schema['oneOf'])) {
      const branchResults = (schema['oneOf'] as SchemaNode[]).map((v) => this.branchIssues(v, value, path));
      const matched = branchResults.filter((b) => b.length === 0).length;
      if (matched !== 1) {
        issues.push(issue('schema', 'oneOf', path, `expected exactly one matching variant, ${matched} matched`));
        if (matched === 0) {
          // Attach the closest variant's failures so callers see the precise intended reason.
          let best = 0;
          branchResults.forEach((b, i) => {
            if (b.length < (branchResults[best]?.length ?? Number.MAX_VALUE)) best = i;
          });
          for (const sub of branchResults[best] ?? []) issues.push(sub);
        }
      }
    }
    if (Array.isArray(schema['anyOf'])) {
      const matched = (schema['anyOf'] as SchemaNode[]).filter((v) => this.branchIssues(v, value, path).length === 0).length;
      if (matched === 0) issues.push(issue('schema', 'anyOf', path, 'no anyOf variant matched'));
    }
    if (Array.isArray(schema['allOf'])) {
      (schema['allOf'] as SchemaNode[]).forEach((v) => this.checkNode(v, value, path, refPath, issues));
    }

    // --- string keywords ---
    if (typeof value === 'string') {
      const minL = schema['minLength'];
      if (typeof minL === 'number' && value.length < minL) {
        issues.push(issue('schema', 'minLength', path, `string shorter than ${minL}`));
      }
      const maxL = schema['maxLength'];
      if (typeof maxL === 'number' && value.length > maxL) {
        issues.push(issue('schema', 'maxLength', path, `string longer than ${maxL}`));
      }
      const pattern = schema['pattern'];
      if (typeof pattern === 'string' && !new RegExp(pattern, 'u').test(value)) {
        issues.push(issue('schema', 'pattern', path, `does not match pattern ${pattern}`));
      }
      if (schema['format'] === 'date-time' && !isValidDateTime(value)) {
        issues.push(issue('schema', 'format', path, 'not a valid RFC 3339 date-time'));
      }
    }

    // --- numeric keywords ---
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        issues.push(issue('schema', 'type', path, 'non-finite number is not valid JSON data'));
      } else {
        const min = schema['minimum'];
        if (typeof min === 'number' && value < min) issues.push(issue('schema', 'minimum', path, `${value} < minimum ${min}`));
        const max = schema['maximum'];
        if (typeof max === 'number' && value > max) issues.push(issue('schema', 'maximum', path, `${value} > maximum ${max}`));
      }
    }

    // --- object keywords ---
    if (isPlainObject(value)) {
      const properties = isPlainObject(schema['properties']) ? schema['properties'] : {};
      const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];
      for (const key of required) {
        if (!(key in value)) issues.push(issue('schema', 'required', path, `missing required property ${JSON.stringify(key)}`));
      }
      for (const [key, subschema] of Object.entries(properties)) {
        if (key in value) this.checkNode(subschema as SchemaNode, value[key], pointer(path, key), `${refPath}/properties/${key}`, issues);
      }
      const additional = schema['additionalProperties'];
      const extras = Object.keys(value).filter((k) => !(k in properties));
      if (additional === false) {
        for (const key of extras) issues.push(issue('schema', 'additionalProperties', pointer(path, key), `unknown key ${JSON.stringify(key)}`));
      } else if (isPlainObject(additional) || additional === true) {
        if (isPlainObject(additional)) {
          for (const key of extras) this.checkNode(additional, value[key], pointer(path, key), `${refPath}/additionalProperties`, issues);
        }
      }
    }

    // --- array keywords ---
    if (Array.isArray(value)) {
      const minI = schema['minItems'];
      if (typeof minI === 'number' && value.length < minI) issues.push(issue('schema', 'minItems', path, `fewer than ${minI} items`));
      const maxI = schema['maxItems'];
      if (typeof maxI === 'number' && value.length > maxI) issues.push(issue('schema', 'maxItems', path, `more than ${maxI} items`));
      const items = schema['items'];
      if (items !== undefined) value.forEach((v, i) => this.checkNode(items as SchemaNode, v, pointer(path, i), `${refPath}/items`, issues));
    }
  }

  /** Run a combinator branch in a scratch issue list; document context is preserved. */
  private branchIssues(schema: SchemaNode, value: unknown, path: string): ContractIssue[] {
    const sub: ContractIssue[] = [];
    this.checkNode(schema, value, path, '#branch', sub);
    return sub;
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}
