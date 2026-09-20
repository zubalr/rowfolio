/**
 * Deterministic pipeline fixtures: one edge-case CSV exercising zero,
 * missing, negative, large, and near-boundary decimals, category
 * variants, duplicates, ambiguous/impossible dates, Arabic-Indic digits
 * with RTL text, and formula-like strings — plus the confirmed column
 * plan, scope, and scenario definition the pipeline runs with.
 */
import { createHash } from 'node:crypto';
import type { RawTable, ScenarioDefinition } from '../../../packages/contracts/src/index.ts';
import type { AnalysisOptions } from '../../../packages/analysis/src/index.ts';
import { profileTable } from '../../../packages/normalize/src/index.ts';
import type { ApprovalPlan } from '../../../packages/normalize/src/index.ts';
import { rawFromCsvBytes } from './bridge.ts';

export const CREATED_AT = '2026-09-20T00:00:00Z';

export const EDGE_CSV = [
  'id,date,region,revenue,operating_cost,tip,note,score',
  'T-001,2026-06-01,North,100.00,60.00,1.00,plain,80',
  'T-002,2026-06-02,North,0,0,2.00,zero amounts,90',
  'T-003,2026-06-03,North,-25.50,10.00,3.00,negative revenue,',
  'T-004,2026-06-04,North,999999999999999999999999999999.99,1.00,4.00,thirty sig digits,70',
  'T-005,2026-06-05,North,1234567890123456,2.00,5.00,sixteen digits,60',
  'T-006,2026-06-06,north ,50.00,25.00,6.00,category variant,50',
  'T-007,2026-06-07,North,,40.00,7.00,missing amount,40',
  'T-008,2026-06-08,North,abc,30.00,8.00,invalid amount,30',
  'T-009,2026-06-09,North,75.25,20.00,9.00,=SUM(A1:A2),20',
  'T-010,01/02/2026,North,10.00,5.00,10.00,slash date,10',
  'T-011,2026-02-30,North,10.00,5.00,11.00,impossible date,10',
  'T-012,2026-06-12,الجنوب,١٢٣٤٫٥٠,5.00,12.00,arabic indic,10',
  'T-001,2026-06-01,North,100.00,60.00,1.00,plain,80',
].join('\n');

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function edgeRaw(): RawTable {
  const bytes = new TextEncoder().encode(EDGE_CSV);
  return rawFromCsvBytes(bytes, { sourceName: 'edge.csv', sourceHash: sha256Hex(bytes) });
}

/**
 * Confirmation plan: approves the duplicate exclusion and the category
 * map, confirms every proposed column, and marks amount/cost as confirmed
 * additive USD measures with the date column as the date axis. This mirrors
 * what a user (or the sample manifest) supplies — the engine never invents it.
 */
export function edgeApprovals(raw: RawTable): ApprovalPlan {
  const profile = profileTable(raw);
  const approved = profile.issues
    .filter((q) => q.kind === 'duplicate' || q.kind === 'category')
    .map((q) => q.id);
  const columns = profile.proposedColumns.map((column) => {
    if (column.id === 'revenue' || column.id === 'operating_cost' || column.id === 'tip') {
      // Confirmation promotes the semantic role: the engine never infers
      // "measure" (or additivity, or currency) from a raw label alone.
      // `tip` is deliberately catalog-keyless to pin the skip rule below.
      return {
        ...column,
        confirmed: true,
        role: 'measure' as const,
        additive: true,
        unit: { kind: 'currency' as const, label: 'USD', currency: 'USD' as const },
      };
    }
    if (column.id === 'date') {
      return { ...column, confirmed: true, type: 'date' as const, role: 'date' as const };
    }
    return { ...column, confirmed: true };
  });
  return { issueIds: approved, columns, useUnverifiedFormulaCaches: [] };
}

export function edgeScope(): AnalysisOptions['confirmedScope'] {
  return {
    tableId: 'raw-bridge-csv',
    periodStart: '2026-06-01',
    periodEnd: '2026-06-30',
    regions: [],
    complete: false,
    coverageNoteKey: 'coverage.partial',
  };
}

/** Operating-cost recipe bound to the generic totals of this pipeline. */
export function edgeDefinition(): ScenarioDefinition {
  return {
    id: 'operating-cost-v1',
    version: '1.0.0',
    parameter: {
      id: 'costChange',
      unit: 'fraction',
      min: '-0.20',
      max: '0.30',
      sliderStep: '0.01',
      typedStep: '0.001',
      default: '0',
    },
    requiresMetricIds: ['total-revenue', 'total-operating_cost'],
    aggregationPolicy: 'factor-after-aggregate',
    assumptionKeys: ['scenario.assumption.revenueFixed', 'scenario.assumption.mechanical'],
  };
}
