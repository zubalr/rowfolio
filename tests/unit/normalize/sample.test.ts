/**
 * Sample-ledger parity: the builder, fed the canonical sample CSV plus the
 * manifest-equivalent approval plan, reproduces the checked-in golden table
 * structure (columns, rows, issue ledger) and yields a stable revision.
 *
 * The golden `normalizationRevision` itself is bound by the planning binder
 * payload; this package's revision binds the richer production payload
 * (policy version, column roles/units, source range, approved transforms),
 * so the test asserts determinism — not byte-equality with the binder hash.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertNormalizedTable,
  type Column,
  type NormalizedTable,
  type RawTable,
} from '../../../packages/contracts/src/index.ts';
import {
  normalizeTable,
  originalValue,
  profileTable,
} from '../../../packages/normalize/src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(HERE, '..', '..', '..', 'fixtures', 'sample');
const CONTRACT_FIXTURES = join(HERE, '..', '..', '..', 'tests', 'contract', 'fixtures');

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** RawTable synthesized from the canonical sample CSV (header row 1, 11 columns). */
function sampleRaw(): RawTable {
  const text = readFileSync(join(SAMPLE, 'sample_operations.csv'), 'utf8');
  const lines = text.split('\n').filter((l) => l.length > 0);
  const header = (lines[0] as string).split(',');
  const sourceHash = sha256Hex(readFileSync(join(SAMPLE, 'sample_operations.xlsx')));
  const cells: RawTable['cells'] = [];
  lines.forEach((line, index) => {
    const row = index + 1;
    for (const [c, value] of line.split(',').entries()) {
      cells.push({
        row,
        column: c + 1,
        raw: row === 1 ? (header[c] as string) : value,
        type: 'text',
        formula: null,
        cachedValue: null,
      });
    }
  });
  return {
    id: 'raw-operations',
    sourceRef: {
      id: 'source-operations',
      sourceHash,
      workbookName: 'sample_operations.xlsx',
      format: 'xlsx',
      sheetId: 'S0',
      sheetName: 'Operations',
      headerRow: 1,
      range: { firstRow: 1, lastRow: lines.length, firstColumn: 1, lastColumn: header.length },
    },
    cells,
    dateSystem: 'not-applicable',
    warnings: [],
  };
}

const golden = loadJson<NormalizedTable>(join(CONTRACT_FIXTURES, 'normalized-table.example.json'));

const RESOLVED_IDS = golden.qualityIssues.filter((q) => q.status === 'resolved').map((q) => q.id);

function approvals() {
  return {
    issueIds: RESOLVED_IDS,
    columns: golden.columns as Column[],
    useUnverifiedFormulaCaches: [],
  };
}

describe('sample ledger parity', () => {
  it('proposes exactly the 29-issue ledger shape (17 duplicates, 7 categories, 5 missing)', () => {
    const raw = sampleRaw();
    const profile = profileTable(raw);
    const kinds = profile.issues.map((q) => q.kind).sort();
    expect(kinds).toEqual([
      ...Array<string>(7).fill('category'),
      ...Array<string>(17).fill('duplicate'),
      ...Array<string>(5).fill('missing'),
    ]);
    expect(new Set(profile.issues.map((q) => q.id)).size).toBe(29);
  });

  it('normalizes to the golden rows, columns and ledger', () => {
    const table = normalizeTable(sampleRaw(), approvals());
    assertNormalizedTable(table);
    expect(table.rows).toEqual(golden.rows);
    expect(table.columns).toEqual(golden.columns);
    const normalizeApproval = (q: { approval: string }) =>
      q.approval === 'user' ? 'sample-manifest' : q.approval;
    // The ledger is a set; emission order is an implementation detail.
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);
    expect(
      table.qualityIssues.map((q) => ({ ...q, approval: normalizeApproval(q) })).sort(byId),
    ).toEqual(golden.qualityIssues.slice().sort(byId));
    expect(table.rows).toHaveLength(2400);
    expect(table.policyVersion).toBe('1.0.0');
  });

  it('keeps excluded duplicate rows out of rows but linked in the ledger', () => {
    const table = normalizeTable(sampleRaw(), approvals());
    expect(table.rows.some((r) => r.sourceRow >= 2402)).toBe(false);
    const dupes = table.qualityIssues.filter((q) => q.kind === 'duplicate');
    expect(dupes).toHaveLength(17);
    for (const d of dupes) {
      expect(d.status).toBe('resolved');
      expect(d.canonicalSourceRow).toBeGreaterThanOrEqual(2);
      expect(d.canonicalSourceRow).toBeLessThanOrEqual(2401);
    }
  });

  it('is deterministic: same input and approvals yield the same table and revision', () => {
    const first = normalizeTable(sampleRaw(), approvals());
    const second = normalizeTable(sampleRaw(), approvals());
    expect(second).toEqual(first);
    expect(first.normalizationRevision).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reverses every approved category map back to the raw cell', () => {
    const table = normalizeTable(sampleRaw(), approvals());
    const cases: Array<[number, string, string]> = [
      [19, 'region', 'NORTH'],
      [91, 'region', ' north '],
      [1536, 'region', 'WEST'],
    ];
    for (const [row, field, rawValue] of cases) {
      expect(originalValue(table, row, field)).toBe(rawValue);
    }
  });

  it('retains missing optional cells as missing (never zero, never imputed)', () => {
    const table = normalizeTable(sampleRaw(), approvals());
    for (const row of [40, 447, 999, 1645, 2257]) {
      expect(table.rows.find((r) => r.sourceRow === row)?.values['csat_score']).toBeNull();
    }
  });
});
