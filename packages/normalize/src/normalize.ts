/**
 * Reversible normalization builder: applies ONLY approved actions.
 * The raw table is never mutated; every change lands in the quality ledger
 * with before/after values, and excluded rows stay queryable through the
 * ledger's `canonicalSourceRow` links. No imputation, no fuzzy merges,
 * no outlier removal, no silent repair.
 */
import {
  canonicalize,
  isDecimal,
  POLICY,
} from '@rowfolio/contracts';
import type {
  CellValue,
  Column,
  NormalizedRow,
  NormalizedTable,
  QualityIssue,
  RawTable,
} from '@rowfolio/contracts';
import { cellAt, cellText, dataRows, indexCells, profileTable } from './profile.ts';
import { sha256HexUtf8 } from './sha256.ts';

/**
 * Explicit approval plan driving the transform ledger. Structural mirror
 * of the contract `ApprovalPlan` interface: this package only imports the
 * `@rowfolio/contracts` entry point (deep workspace imports are forbidden
 * by repo convention), so the three approval fields are spelled out here.
 */
export interface ApprovalPlan {
  readonly issueIds: readonly string[];
  readonly columns: readonly Column[];
  readonly useUnverifiedFormulaCaches: readonly string[];
}

export class NormalizeError extends Error {
  readonly code: 'unknown-issue' | 'unknown-column' | 'empty-columns';
  constructor(code: NormalizeError['code'], message: string) {
    super(message);
    this.name = 'NormalizeError';
    this.code = code;
  }
}

export interface RevisionPayload {
  readonly policy: string;
  readonly sourceHash: string;
  readonly sourceRange: { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number };
  readonly columns: ReadonlyArray<Pick<Column, 'id' | 'type' | 'role' | 'unit' | 'additive' | 'confirmed'>>;
  readonly rows: ReadonlyArray<{ id: string; sourceRow: number; values: Record<string, CellValue> }>;
  readonly approvedIssues: readonly string[];
}

/** Deterministic semantic hash binding policy, roles, values and approvals. */
export function normalizationRevisionOf(payload: RevisionPayload): string {
  return sha256HexUtf8(canonicalize(payload));
}

/** Reconstruct the pre-normalization cell value from the ledger (reversibility). */
export function originalValue(
  table: NormalizedTable,
  sourceRow: number,
  fieldId: string,
): CellValue {
  const issue = table.qualityIssues.find(
    (q) => q.sourceRow === sourceRow && q.fieldId === fieldId && q.original !== null,
  );
  if (issue?.original !== undefined && issue.original !== null) return issue.original;
  return table.rows.find((r) => r.sourceRow === sourceRow)?.values[fieldId] ?? null;
}

function toCellValue(raw: string | null, column: Column): CellValue {
  if (raw === null || raw === '') return null;
  const trimmed = raw.trim();
  if (column.type === 'boolean') {
    if (/^(true|yes|نعم)$/i.test(trimmed)) return true;
    if (/^(false|no|لا)$/i.test(trimmed)) return false;
    return raw;
  }
  if ((column.type === 'decimal' || column.type === 'integer') && isDecimal(trimmed)) {
    // Preserve the input scale verbatim (money display scale, e.g. `9916.70`):
    // the golden table keeps trailing fractional zeros, and the contract
    // requires scale preservation alongside nonexponent form.
    return trimmed;
  }
  return raw;
}

export function normalizeTable(raw: RawTable, approvals: ApprovalPlan): NormalizedTable {
  const profile = profileTable(raw);
  const columns = approvals.columns.length > 0 ? [...approvals.columns] : profile.proposedColumns;
  if (columns.length === 0) {
    throw new NormalizeError('empty-columns', 'normalizeTable requires at least one column');
  }
  const byId = new Map(columns.map((c) => [c.id, c] as const));
  const bySourceColumn = new Map(columns.map((c) => [c.sourceColumn, c] as const));
  const knownIssueIds = new Set(profile.issues.map((q) => q.id));
  for (const id of approvals.issueIds) {
    if (!knownIssueIds.has(id)) {
      throw new NormalizeError('unknown-issue', `approval references proposed issue ${JSON.stringify(id)}`);
    }
  }
  const approved = new Set(approvals.issueIds);
  const useCache = new Set(approvals.useUnverifiedFormulaCaches);
  void byId;
  void bySourceColumn;

  const excluded = new Set<number>();
  const mapped = new Map<string, string>();
  for (const q of profile.issues) {
    if (!approved.has(q.id)) continue;
    if (q.kind === 'duplicate' && q.action === 'exclude-row') excluded.add(q.sourceRow);
    if (q.kind === 'category' && q.action === 'map-category' && q.fieldId !== null && q.normalized !== null) {
      mapped.set(`${q.sourceRow}:${q.fieldId}`, q.normalized);
    }
  }

  const rows: NormalizedRow[] = [];
  const index = indexCells(raw);
  for (const r of dataRows(raw)) {
    if (excluded.has(r)) continue;
    const values: Record<string, CellValue> = {};
    for (const column of columns) {
      const cell = cellAt(index, r, column.sourceColumn);
      if (cell?.type === 'formula') {
        const cacheId = `quality-formula-${r}-c${column.sourceColumn}`;
        if (useCache.has(column.id) && approved.has(cacheId) && cell.cachedValue !== null) {
          values[column.id] = toCellValue(cell.cachedValue, column);
        } else {
          values[column.id] = null;
        }
        continue;
      }
      const override = mapped.get(`${r}:${column.id}`);
      if (override !== undefined) {
        values[column.id] = override;
        continue;
      }
      values[column.id] = toCellValue(cellText(cell), column);
    }
    rows.push({
      id: `${raw.sourceRef.sheetId}:R${r}`,
      sourceRow: r,
      sourceRefId: raw.sourceRef.id,
      values,
    });
  }

  const ledger: QualityIssue[] = profile.issues.map((q) => {
    if (approved.has(q.id)) {
      return { ...q, status: 'resolved' as const, approval: 'user' as const };
    }
    if (q.kind === 'missing') {
      return { ...q, status: 'unresolved' as const };
    }
    return q;
  });

  const revision = normalizationRevisionOf({
    policy: POLICY.version,
    sourceHash: raw.sourceRef.sourceHash,
    sourceRange: { ...raw.sourceRef.range },
    columns: columns.map((c) => ({
      id: c.id, type: c.type, role: c.role, unit: c.unit,
      additive: c.additive, confirmed: c.confirmed,
    })),
    rows: rows.map((r) => ({ id: r.id, sourceRow: r.sourceRow, values: r.values })),
    approvedIssues: [...approved].sort(),
  });

  return {
    schemaVersion: '1.0.0',
    id: raw.id,
    sourceRef: { ...raw.sourceRef },
    normalizationRevision: revision,
    columns,
    rows,
    qualityIssues: ledger,
    grain: [],
    calendarDates: [],
    policyVersion: POLICY.version,
  };
}
