/**
 * Native workbook writer: an output-only ExcelJS adapter over a validated
 * ExportModel. Values and provenance are preserved from the model, never
 * recomputed; the only generated formulas are constant templates over the
 * writer's own layout, each carrying the model's cached result.
 *
 * User strings (including `=`, `+`, `-`, `@` prefixes) are always written
 * as shared-string cells. Values beyond 15 significant digits become text
 * with their scale intact. No macros, external links, or source objects
 * are ever copied.
 */
import ExcelJS from 'exceljs';
import {
  assertExportModel,
  isDecimal,
  sha256Hex,
  significantDigits,
} from '@rowfolio/contracts';
import type { ExportArtifact, ExportModel } from '@rowfolio/contracts';

/**
 * Build progress callback. Structural mirror of the contract `Progress`
 * type: stage names are writer-defined, fractions are monotonic within a
 * stage and null when the work can't be measured.
 */
export type Progress = (stage: string, fraction: number | null) => void;

/** Native build output: metadata plus out-of-band bytes. */
export interface BuiltArtifact {
  readonly metadata: ExportArtifact;
  readonly bytes: ArrayBuffer;
}

export class ExportXlsxError extends Error {
  readonly code: 'limit-exceeded' | 'unsafe-name' | 'invalid-model';
  constructor(code: ExportXlsxError['code'], message: string) {
    super(message);
    this.name = 'ExportXlsxError';
    this.code = code;
  }
}

/** Row cap mirrors the ingestion guardrail (50,000 rows including header). */
export const MAX_EXPORT_DATA_ROWS = 50000;
/** Excel's hard per-cell character ceiling. */
export const MAX_CELL_CHARACTERS = 32767;

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const TABLE_NAMES: Record<string, string> = {
  clean: 'CleanData',
  quality: 'DataQuality',
  kpis: 'KpiAnalysis',
  methodology: 'Methodology',
};

const UNSAFE_SHEET = /[[\]:*?/\\]/;

export function assertSafeSheetName(name: string): void {
  if (name.length === 0 || name.length > 31 || UNSAFE_SHEET.test(name)) {
    throw new ExportXlsxError('unsafe-name', `unsafe sheet name ${JSON.stringify(name)}`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(name)) {
    throw new ExportXlsxError('unsafe-name', `sheet name contains control characters`);
  }
}

/** Validate model-level limits before allocating the workbook. */
export function validateModelLimits(model: ExportModel): void {
  if (model.table.rows.length > MAX_EXPORT_DATA_ROWS) {
    throw new ExportXlsxError(
      'limit-exceeded',
      `cleaned rows ${model.table.rows.length} exceed the ${MAX_EXPORT_DATA_ROWS} export cap`,
    );
  }
}

function toCellValue(value: string | boolean | null): string | number | boolean | null {
  if (value === null || typeof value === 'boolean') return value;
  if (value.length > MAX_CELL_CHARACTERS) {
    throw new ExportXlsxError('limit-exceeded', `cell exceeds ${MAX_CELL_CHARACTERS} characters`);
  }
  if (isDecimal(value) && significantDigits(value) <= 15) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  // Formula-like text, long decimals, identifiers and dates stay strings:
  // ExcelJS writes string values as shared strings, never as formulas.
  return value;
}

function numFmtFor(kind: string | undefined): string {
  switch (kind) {
    case 'currency':
      return '#,##0.00';
    case 'count':
    case 'minutes':
    case 'score':
      return '#,##0';
    case 'ratio':
      return '0.0%';
    default:
      return 'General';
  }
}

function columnLetter(index1: number): string {
  let n = index1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Escape a criterion for embedding in a `"..."` Excel string literal:
 * embedded quotes double (`"` → `""`) so hostile text stays one literal
 * and can never break out into formula syntax.
 */
export function escapeFormulaStringLiteral(text: string): string {
  return text.replace(/"/g, '""');
}

interface KpiPlacement {
  readonly row: number;
  readonly valueAddress: string;
}

export const buildWorkbook = async (
  model: ExportModel,
  progress: Progress,
): Promise<BuiltArtifact> => {
  progress('model', 0.05);
  // Fail fast on size before any allocation or validation work.
  validateModelLimits(model);
  assertExportModel(model);
  for (const sheet of model.sheets) assertSafeSheetName(sheet.name);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Rowfolio';
  workbook.created = new Date(model.createdAt);
  workbook.modified = new Date(model.createdAt);

  const rtl = model.locale === 'ar';
  const byId = new Map(model.sheets.map((s) => [s.id, s] as const));
  const worksheets = new Map<string, ExcelJS.Worksheet>();
  for (const sheet of model.sheets) {
    worksheets.set(
      sheet.id,
      workbook.addWorksheet(sheet.name, {
        views: [{ state: 'frozen', ySplit: 1, rightToLeft: rtl }],
      }),
    );
  }
  const get = (id: string): ExcelJS.Worksheet => {
    const ws = worksheets.get(id);
    if (ws === undefined) throw new ExportXlsxError('invalid-model', `missing sheet ${id}`);
    return ws;
  };

  progress('layout', 0.25);

  // ---- Executive Summary -------------------------------------------------
  const summary = get('summary');
  summary.columns = [{ width: 28 }, { width: 72 }];
  const scopeText = [
    model.scope.periodStart ?? 'all',
    model.scope.periodEnd ?? 'all',
    model.scope.regions.length > 0 ? model.scope.regions.join(', ') : 'all regions',
  ].join(' / ');
  const summaryRows: Array<[string, string | number]> = [
    ['Scope', scopeText],
    ['Source', `${model.table.sourceRef.workbookName}#${model.table.sourceRef.sheetName}`],
    ['Records', `${model.qualitySummary.retainedRows} retained / ${model.qualitySummary.rawRows} raw`],
    [
      'Scenario',
      model.scenario !== null && model.scenario.status === 'defined'
        ? `Includes ${formatPercent(model.scenario.costChange)} operating-cost scenario`
        : 'Baseline (no scenario)',
    ],
    ['Generated', model.createdAt],
  ];
  summaryRows.forEach(([label, value], i) => {
    const row = summary.getRow(i + 1);
    row.getCell(1).value = label;
    row.getCell(2).value = value;
  });
  let headlineRow = summaryRows.length + 2;
  summary.getRow(headlineRow).getCell(1).value = 'Key metrics';
  headlineRow += 1;
  const headlineIds = ['june-revenue', 'june-operating-cost', 'june-contribution', 'june-margin'];
  for (const id of headlineIds) {
    const metric = model.metrics.find((m) => m.id === id);
    if (metric?.value == null) continue;
    headlineRow += 1;
    const row = summary.getRow(headlineRow);
    row.getCell(1).value = metric.labelKey;
    const cell = row.getCell(2);
    const raw = toCellValue(metric.value);
    cell.value = raw;
    if (typeof raw === 'number') cell.numFmt = numFmtFor(metric.unit.kind);
  }

  // ---- Cleaned Data --------------------------------------------------------
  const clean = get('clean');
  const dataColumns = [...model.table.columns];
  const headers = [...dataColumns.map((c) => c.id), 'source_sheet', 'source_row', 'record_id'];
  clean.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(12, Math.min(h.length + 4, 28)) }));
  const cleanLetters = new Map<string, string>();
  headers.forEach((h, i) => cleanLetters.set(h, columnLetter(i + 1)));
  const cleanName = (byId.get('clean')?.name ?? 'Cleaned Data').replace(/'/g, "''");
  model.table.rows.forEach((row) => {
    const record: Record<string, string | number | boolean | null> = {};
    for (const column of dataColumns) {
      const raw = row.values[column.id] ?? null;
      record[column.id] = typeof raw === 'string' ? toCellValue(raw) : raw;
    }
    record['source_sheet'] = model.table.sourceRef.sheetName;
    record['source_row'] = row.sourceRow;
    record['record_id'] = row.id;
    clean.addRow(record);
  });
  clean.addTable({
    name: TABLE_NAMES['clean'] as string,
    ref: `A1:${columnLetter(headers.length)}${model.table.rows.length + 1}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: headers.map((h) => ({ name: h, filterButton: true })),
    rows: [],
  });
  clean.autoFilter = {
    from: 'A1',
    to: `${columnLetter(headers.length)}${model.table.rows.length + 1}`,
  };

  progress('layout', 0.5);

  // ---- KPI Analysis (cached template formulas) ------------------------------
  const kpis = get('kpis');
  kpis.columns = [
    { header: 'Metric', key: 'metric', width: 26 },
    { header: 'Value', key: 'value', width: 20 },
    { header: 'Unit', key: 'unit', width: 16 },
    { header: 'Coverage', key: 'coverage', width: 30 },
  ];
  const placements = new Map<string, KpiPlacement>();
  const lastCleanRow = model.table.rows.length + 1;
  const sumFormula = (field: string): string =>
    `SUM('${cleanName}'!${cleanLetters.get(field)}2:${cleanLetters.get(field)}${lastCleanRow})`;
  const sumIfsFormula = (field: string, region: string, start: [number, number, number], end: [number, number, number]): string => {
    const col = `${cleanLetters.get(field)}`;
    const regionCol = `${cleanLetters.get('region')}`;
    const dateCol = `${cleanLetters.get('date')}`;
    const criterion = escapeFormulaStringLiteral(region);
    return `SUMIFS('${cleanName}'!${col}2:${col}${lastCleanRow},'${cleanName}'!${regionCol}2:${regionCol}${lastCleanRow},"${criterion}",'${cleanName}'!${dateCol}2:${dateCol}${lastCleanRow},">="&DATE(${start[0]},${start[1]},${start[2]}),'${cleanName}'!${dateCol}2:${dateCol}${lastCleanRow},"<"&DATE(${end[0]},${end[1]},${end[2]}))`;
  };
  const ymd = (iso: string): [number, number, number] => [
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)),
    Number(iso.slice(8, 10)),
  ];
  const firstOfNextMonth = (end: string): [number, number, number] => {
    const y = Number(end.slice(0, 4));
    const m = Number(end.slice(5, 7));
    return m === 12 ? [y + 1, 1, 1] : [y, m + 1, 1];
  };

  for (const metric of model.metrics) {
    if (metric.id.startsWith('quality-')) continue;
    const rowIndex = kpis.rowCount + 1;
    const row = kpis.getRow(rowIndex);
    row.getCell(1).value = metric.labelKey;
    const valueCell = row.getCell(2);
    const numeric = metric.value !== null ? toCellValue(metric.value) : null;
    placements.set(metric.id, { row: rowIndex, valueAddress: `$B$${rowIndex}` });
    valueCell.value = numeric;
    if (typeof numeric === 'number') valueCell.numFmt = numFmtFor(metric.unit.kind);
    row.getCell(3).value = metric.unit.label;
    row.getCell(4).value = `eligible ${metric.eligibleRows}/${metric.totalRows}; ${metric.scope.coverageNoteKey}`;
  }
  // Second pass: constant template formulas with the model's cached results.
  // Placements are complete, so cross-metric references always resolve.
  for (const metric of model.metrics) {
    if (metric.id.startsWith('quality-')) continue;
    const placement = placements.get(metric.id);
    if (placement === undefined) continue;
    const numeric = metric.value !== null ? toCellValue(metric.value) : null;
    if (typeof numeric !== 'number') continue;
    const formula = formulaForMetric(
      metric.id,
      { sumFormula, sumIfsFormula, ymd, firstOfNextMonth },
      model,
      placements,
    );
    if (formula !== null) {
      kpis.getRow(placement.row).getCell(2).value = { formula, result: numeric };
    }
  }
  kpis.addTable({
    name: TABLE_NAMES['kpis'] as string,
    ref: `A1:D${kpis.rowCount}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: ['Metric', 'Value', 'Unit', 'Coverage'].map((name) => ({ name, filterButton: true })),
    rows: [],
  });
  kpis.autoFilter = { from: 'A1', to: `D${kpis.rowCount}` };

  progress('tables', 0.75);

  // ---- Data Quality ----------------------------------------------------------
  const quality = get('quality');
  quality.columns = [
    { header: 'Issue', key: 'issue', width: 24 },
    { header: 'Kind', key: 'kind', width: 14 },
    { header: 'Row', key: 'row', width: 10 },
    { header: 'Field', key: 'field', width: 18 },
    { header: 'Original', key: 'original', width: 20 },
    { header: 'Normalized', key: 'normalized', width: 20 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Action', key: 'action', width: 14 },
    { header: 'Approval', key: 'approval', width: 16 },
  ];
  for (const issue of model.table.qualityIssues) {
    quality.addRow({
      issue: issue.id,
      kind: issue.kind,
      row: issue.sourceRow,
      field: issue.fieldId ?? '',
      original: issue.original ?? '',
      normalized: issue.normalized ?? '',
      status: issue.status,
      action: issue.action,
      approval: issue.approval,
    });
  }
  quality.addTable({
    name: TABLE_NAMES['quality'] as string,
    ref: `A1:I${model.table.qualityIssues.length + 1}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: ['Issue', 'Kind', 'Row', 'Field', 'Original', 'Normalized', 'Status', 'Action', 'Approval'].map(
      (name) => ({ name, filterButton: true }),
    ),
    rows: [],
  });
  quality.autoFilter = { from: 'A1', to: `I${model.table.qualityIssues.length + 1}` };

  // ---- Methodology -------------------------------------------------------------
  const method = get('methodology');
  method.columns = [{ width: 30 }, { width: 90 }];
  const methodRows: Array<[string, string]> = [
    ['Policy', '1.0.0'],
    ['Analysis', model.analysisId],
    ['Source hash', model.sourceHash],
    ['Table revision', model.table.normalizationRevision],
    ['Template', '1.0.0'],
    ['Locale', `${model.locale} / ${model.numberingSystem}`],
    ['Precision', '40 / ROUND_HALF_UP'],
    ['Scope', `${model.scope.periodStart ?? 'all'}..${model.scope.periodEnd ?? 'all'}`],
  ];
  for (const proof of model.provenance) {
    const spans = proof.selections.map((s) => s.spans.map((span) => `${span.start}-${span.end}`).join(',')).join(';');
    methodRows.push([
      `Proof ${proof.id}`,
      `${JSON.stringify(proof.expression)} = ${proof.result ?? proof.reasonKey}${spans === '' ? '' : ` [${spans}]`}`,
    ]);
  }
  methodRows.push(['Limits', 'No forecast or causal claim. Cached results are authoritative; recalculation on open is an aid.']);
  methodRows.forEach(([label, detail], i) => {
    const row = method.getRow(i + 1);
    row.getCell(1).value = label;
    row.getCell(2).value = detail;
    row.getCell(2).alignment = { wrapText: true };
  });
  method.addTable({
    name: TABLE_NAMES['methodology'] as string,
    ref: `A1:B${methodRows.length}`,
    headerRow: false,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: false },
    columns: [{ name: 'Item' }, { name: 'Detail' }],
    rows: [],
  });

  progress('package', null);
  // writeBuffer resolves to a byte array (Uint8Array in browsers); the
  // metadata travels in the message while these bytes travel out of band.
  const raw = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
  const view = raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength
    ? new Uint8Array(raw.buffer as ArrayBuffer)
    : new Uint8Array(raw.buffer as ArrayBuffer, raw.byteOffset, raw.byteLength);
  const bytes = view.slice().buffer;
  const sha256 = await sha256Hex(new Uint8Array(bytes));
  progress('ready', 1);
  return {
    metadata: {
      exportId: model.exportId,
      format: 'xlsx',
      mime: MIME,
      filename: `rowfolio-${model.exportId}.xlsx`,
      byteLength: bytes.byteLength,
      sha256,
      binarySlot: 'workbook',
    },
    bytes,
  };
};

interface FormulaHelpers {
  readonly sumFormula: (field: string) => string;
  readonly sumIfsFormula: (
    field: string,
    region: string,
    start: [number, number, number],
    end: [number, number, number],
  ) => string;
  readonly ymd: (iso: string) => [number, number, number];
  readonly firstOfNextMonth: (end: string) => [number, number, number];
}

/**
 * Constant template formulas over the writer's own layout. Scope bounds come
 * from the validated model scope; no source cell text is ever interpolated.
 */
function formulaForMetric(
  metricId: string,
  helpers: FormulaHelpers,
  model: ExportModel,
  placements: ReadonlyMap<string, KpiPlacement>,
): string | null {
  const at = (id: string): string | null => placements.get(id)?.valueAddress ?? null;
  const ref = (id: string): string => {
    const address = at(id);
    if (address === null) throw new ExportXlsxError('invalid-model', `formula references unplaced metric ${id}`);
    return address;
  };
  const metric = model.metrics.find((m) => m.id === metricId);
  const scope = metric?.scope;
  const regions = scope?.regions ?? [];
  const region = regions.length === 1 ? (regions[0] as string) : null;
  const fieldFor: Record<string, string> = {
    'north-june-revenue': 'revenue',
    'north-june-target': 'target_revenue',
    'north-may-orders': 'order_volume',
    'north-june-orders': 'order_volume',
    'north-may-downtime': 'downtime_minutes',
    'north-june-downtime': 'downtime_minutes',
    'june-revenue': 'revenue',
    'june-operating-cost': 'operating_cost',
  };
  const field = fieldFor[metricId];
  if (field !== undefined && scope?.periodStart != null && scope?.periodEnd != null) {
    if (region !== null) {
      return helpers.sumIfsFormula(
        field,
        region,
        helpers.ymd(scope.periodStart),
        helpers.firstOfNextMonth(scope.periodEnd),
      );
    }
    if (regions.length === 0) return helpers.sumFormula(field);
  }
  switch (metricId) {
    case 'north-target-gap': {
      const rev = at('north-june-revenue');
      const tgt = at('north-june-target');
      return rev !== null && tgt !== null ? `IF(${tgt}>0,(${rev}-${tgt})/${tgt},"")` : null;
    }
    case 'north-orders-change':
    case 'north-downtime-change': {
      const pair = metricId === 'north-orders-change'
        ? ['north-june-orders', 'north-may-orders']
        : ['north-june-downtime', 'north-may-downtime'];
      const cur = at(pair[0] as string);
      const prev = at(pair[1] as string);
      return cur !== null && prev !== null ? `IF(${prev}>0,(${cur}-${prev})/${prev},"")` : null;
    }
    case 'june-contribution':
      return `(${ref('june-revenue')}-${ref('june-operating-cost')})`;
    case 'june-margin':
      return `IF(${ref('june-revenue')}>0,${ref('june-contribution')}/${ref('june-revenue')},"")`;
    case 'scenario-cost':
    case 'scenario-contribution':
    case 'scenario-margin':
    case 'scenario-margin-delta-pp':
      return null;
    default:
      return null;
  }
}

function formatPercent(fraction: string): string {
  const num = Number(fraction);
  if (!Number.isFinite(num)) return String(fraction);
  return `${Math.round(num * 1000) / 10}%`;
}
