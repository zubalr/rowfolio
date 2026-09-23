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
import JSZip from 'jszip';
import {
  assertExportModel,
  DESIGN_TOKENS,
  isDecimal,
  sha256Hex,
  significantDigits,
} from '@rowfolio/contracts';
import type { ExportArtifact, ExportModel } from '@rowfolio/contracts';
import { exportFileName, exportUnitLabel, localizeDigits } from '@rowfolio/export-model';
import { hasSheetLabel, sheetLabel } from './labels.ts';

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

/**
 * Metric value for a summary/KPI cell. Decimals always become numeric cells —
 * even beyond 15 significant digits, where the exact canonical decimal is
 * additionally parked in a cell note (`metricNoteText`). Non-decimal text
 * falls back to the string-preserving path.
 */
function toMetricCellValue(value: string): string | number {
  if (isDecimal(value)) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  const cell = toCellValue(value);
  return typeof cell === 'boolean' || cell === null ? value : cell;
}

/** True when the canonical decimal cannot round-trip through float64. */
function needsExactNote(value: string): boolean {
  return isDecimal(value) && significantDigits(value) > 15;
}

/** Exact-value note parked on a precision-bounded numeric cell. */
function metricNoteText(value: string): string {
  return `exact stored value: ${value}`;
}

const GROUP_COUNT = new Intl.NumberFormat('en-US', { useGrouping: true });

function formatCount(value: number, numbering?: 'latn' | 'arab'): string {
  const text = GROUP_COUNT.format(Math.trunc(value));
  return numbering === undefined ? text : localizeDigits(text, numbering);
}

/** Cost-change fraction to whole percent: `0.08` → `8%`. */
function formatChangePercent(fraction: string): string {
  const num = Number(fraction);
  if (!Number.isFinite(num)) return fraction;
  return `${parseFloat((num * 100).toFixed(1))}%`;
}

/** Adverse red for explicitly negative results; restrained by design. */
const ADVERSE_ARGB = 'FF' + DESIGN_TOKENS.color.negative.replace('#', '').toUpperCase();
const INK_ARGB = 'FF' + DESIGN_TOKENS.color.ink.replace('#', '').toUpperCase();
const MUTED_ARGB = 'FF' + DESIGN_TOKENS.color.muted.replace('#', '').toUpperCase();
const PAPER_ARGB = 'FF' + DESIGN_TOKENS.color.paper.replace('#', '').toUpperCase();
const SURFACE_ARGB = 'FF' + DESIGN_TOKENS.color.surface.replace('#', '').toUpperCase();
const RULE_ARGB = 'FF' + DESIGN_TOKENS.color.rule.replace('#', '').toUpperCase();
const RULE_BORDER = { style: 'thin', color: { argb: RULE_ARGB } } as const;

/** Header band: ink text on a surface fill, closed by a hairline rule. */
function styleHeaderRow(row: ExcelJS.Row, cells: number): void {
  for (let c = 1; c <= cells; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: INK_ARGB } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SURFACE_ARGB } };
    cell.border = { bottom: RULE_BORDER };
  }
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
  // Document properties carry the factual author credit — no employer claim.
  workbook.creator = 'Zubair Jashim';
  workbook.lastModifiedBy = 'Zubair Jashim';
  workbook.description = 'Computer Science graduate, Qatar University';
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
  // Observed facts first, assumptions physically separate below. Labels
  // come from the workbook copy tables; numbers stay exact model values.
  const summary = get('summary');
  const locale = model.locale;
  // Portrait A4 fits ~74 width units at body size; the value column wraps
  // instead of spilling onto a second page. Column A must be wide enough for
  // the 16pt title: LibreOffice clips cell text at the column edge even when
  // the neighbor is empty or the range is merged.
  summary.columns = [{ width: 50 }, { width: 48 }];
  const scopeText = [
    model.scope.periodStart ?? 'all',
    model.scope.periodEnd ?? 'all',
    model.scope.regions.length > 0 ? model.scope.regions.join(', ') : sheetLabel(locale, 'common.allRegions'),
  ].join(' / ');
  let summaryRow = 1;
  // The cover slide carries the report identity ('Monthly operations
  // report' for the sample pack, 'Data briefing' for uploads); the summary
  // page mirrors it so the workbook opens on the same title + context.
  const cover = model.slides[0];
  const summaryTitle = summary.getRow(summaryRow);
  summaryTitle.getCell(1).value = cover?.title ?? sheetLabel(locale, 'export.title');
  summaryTitle.getCell(1).font = { bold: true, size: 16, color: { argb: INK_ARGB } };
  for (const c of [1, 2]) {
    summaryTitle.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER_ARGB } };
  }
  summary.mergeCells(`A${summaryRow}:B${summaryRow}`);
  summaryRow += 1;
  if (cover !== undefined && cover.subtitle !== '') {
    const subtitleRow = summary.getRow(summaryRow);
    subtitleRow.getCell(1).value = cover.subtitle;
    subtitleRow.getCell(1).font = { size: 11, color: { argb: MUTED_ARGB } };
    for (const c of [1, 2]) {
      subtitleRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER_ARGB } };
      subtitleRow.getCell(c).border = { bottom: RULE_BORDER };
    }
    // Merge the banded title/subtitle rows so Excel spans the text across the
    // print width (LibreOffice still clips at the column edge — hence the
    // 50-unit column A above).
    summary.mergeCells(`A${summaryRow}:B${summaryRow}`);
    summaryRow += 1;
  } else {
    summaryTitle.getCell(1).border = { bottom: RULE_BORDER };
    summaryTitle.getCell(2).border = { bottom: RULE_BORDER };
    summaryRow += 1;
  }
  summaryRow += 1;
  const observedHeader = summary.getRow(summaryRow);
  observedHeader.getCell(1).value = sheetLabel(locale, 'evidence.title');
  styleHeaderRow(observedHeader, 2);
  summary.mergeCells(`A${summaryRow}:B${summaryRow}`);
  summaryRow += 1;
  const putSummary = (labelText: string, value: string | number, link?: string): void => {
    const row = summary.getRow(summaryRow);
    if (link !== undefined) {
      row.getCell(1).value = { text: labelText, hyperlink: link } as never;
    } else {
      row.getCell(1).value = labelText;
    }
    row.getCell(2).value = value;
    row.getCell(2).alignment = { wrapText: true };
    summaryRow += 1;
  };
  putSummary(sheetLabel(locale, 'workspace.scope'), scopeText);
  putSummary(
    sheetLabel(locale, 'common.rows'),
    sheetLabel(locale, 'workspace.records')
      .replace('{raw}', formatCount(model.qualitySummary.rawRows))
      .replace('{clean}', formatCount(model.qualitySummary.retainedRows)),
  );
  putSummary(
    sheetLabel(locale, 'common.source'),
    `${model.table.sourceRef.workbookName}#${model.table.sourceRef.sheetName}`,
  );
  // Proof row numbers in Methodology (8 fixed rows, then one per proof).
  const methodName = (byId.get('methodology')?.name ?? 'Methodology').replace(/'/g, "''");
  const proofRowOf = new Map(model.provenance.map((p, i) => [p.id, 9 + i] as const));
  const proofLink = (provenanceId: string): string | undefined => {
    const row = proofRowOf.get(provenanceId);
    return row === undefined ? undefined : `#'${methodName}'!A${row}`;
  };
  const headlineMetrics = (() => {
    const picked: NonNullable<ReturnType<typeof model.metrics.find>>[] = [];
    const seen = new Set<string>();
    const consider = (id: string): void => {
      if (seen.has(id)) return;
      const metric = model.metrics.find((m) => m.id === id);
      if (metric === undefined || metric.id.startsWith('quality-')) return;
      seen.add(id);
      picked.push(metric);
    };
    for (const id of ['june-revenue', 'june-operating-cost', 'june-contribution', 'june-margin']) consider(id);
    for (const metric of model.metrics) consider(metric.id);
    return picked.slice(0, 4);
  })();
  for (const metric of headlineMetrics) {
    const labelText = hasSheetLabel(metric.labelKey) ? sheetLabel(locale, metric.labelKey) : metric.labelKey;
    const row = summary.getRow(summaryRow);
    const link = proofLink(metric.provenanceId);
    if (link !== undefined) {
      row.getCell(1).value = { text: labelText, hyperlink: link } as never;
    } else {
      row.getCell(1).value = labelText;
    }
    const raw = metric.value !== null ? toMetricCellValue(metric.value) : null;
    const cell = row.getCell(2);
    if (typeof raw === 'number') {
      cell.value = raw;
      cell.numFmt = numFmtFor(metric.unit.kind);
      cell.font = { bold: true, color: { argb: INK_ARGB } };
      if (metric.unit.kind === 'ratio' && raw < 0) {
        cell.font = { color: { argb: ADVERSE_ARGB }, bold: true };
      }
      if (metric.value !== null && needsExactNote(metric.value)) {
        cell.note = metricNoteText(metric.value);
      }
    } else {
      cell.value = raw;
    }
    summaryRow += 1;
  }
  summaryRow += 1;
  const assumptionsHeader = summary.getRow(summaryRow);
  assumptionsHeader.getCell(1).value = sheetLabel(locale, 'scenario.title');
  styleHeaderRow(assumptionsHeader, 2);
  summary.mergeCells(`A${summaryRow}:B${summaryRow}`);
  summaryRow += 1;
  if (model.scenario !== null && model.scenario.status === 'defined') {
    putSummary(
      sheetLabel(locale, 'scenario.costChange'),
      sheetLabel(locale, 'export.includesScenario')
        .replace('{change}', formatChangePercent(model.scenario.costChange)),
    );
    putSummary(sheetLabel(locale, 'scenario.assumption.revenueFixed'), '');
    putSummary(sheetLabel(locale, 'scenario.assumption.mechanical'), '');
  } else {
    putSummary(sheetLabel(locale, 'common.baseline'), '');
  }
  summary.pageSetup.fitToPage = true;
  summary.pageSetup.fitToWidth = 1;
  summary.pageSetup.fitToHeight = 0;
  summary.pageSetup.printArea = `A1:B${summaryRow - 1}`;

  // ---- Cleaned Data --------------------------------------------------------
  const clean = get('clean');
  const dataColumns = [...model.table.columns];
  const headers = [...dataColumns.map((c) => c.id), 'source_sheet', 'source_row', 'record_id'];
  // Display headings: measure columns get the localized metric names, while
  // identifier/provenance columns keep their raw ids (evidence surfaces stay
  // technical, matching the Methodology field list).
  const displayHeader = (id: string): string => {
    const key = `metric.${id}`;
    return hasSheetLabel(key) ? sheetLabel(locale, key) : id;
  };
  clean.columns = headers.map((h) => {
    const header = displayHeader(h);
    return { header, key: h, width: Math.max(12, Math.min(header.length + 4, 28)) };
  });
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
    columns: headers.map((h) => ({ name: displayHeader(h), filterButton: true })),
    rows: [],
  });
  clean.autoFilter = {
    from: 'A1',
    to: `${columnLetter(headers.length)}${model.table.rows.length + 1}`,
  };

  progress('layout', 0.5);

  // ---- KPI Analysis (cached template formulas) ------------------------------
  const kpis = get('kpis');
  const kpiHeaders = ['table.metric', 'table.value', 'table.unit', 'table.coverage']
    .map((key) => sheetLabel(locale, key));
  kpis.columns = [
    { header: kpiHeaders[0] as string, key: 'metric', width: 26 },
    { header: kpiHeaders[1] as string, key: 'value', width: 20 },
    { header: kpiHeaders[2] as string, key: 'unit', width: 16 },
    { header: kpiHeaders[3] as string, key: 'coverage', width: 30 },
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
    const labelText = hasSheetLabel(metric.labelKey) ? sheetLabel(locale, metric.labelKey) : metric.labelKey;
    const link = proofLink(metric.provenanceId);
    if (link !== undefined) {
      row.getCell(1).value = { text: labelText, hyperlink: link } as never;
    } else {
      row.getCell(1).value = labelText;
    }
    const valueCell = row.getCell(2);
    const numeric = metric.value !== null ? toMetricCellValue(metric.value) : null;
    placements.set(metric.id, { row: rowIndex, valueAddress: `$B$${rowIndex}` });
    valueCell.value = numeric;
    if (typeof numeric === 'number') {
      valueCell.numFmt = numFmtFor(metric.unit.kind);
      if (metric.unit.kind === 'ratio' && numeric < 0) {
        valueCell.font = { color: { argb: ADVERSE_ARGB }, bold: true };
      }
      if (metric.value !== null && needsExactNote(metric.value)) {
        valueCell.note = metricNoteText(metric.value);
      }
    }
    row.getCell(3).value = exportUnitLabel(metric.unit, (key) => sheetLabel(locale, key));
    const coverageKey = metric.scope.coverageNoteKey;
    const coverageText = localizeDigits(
      `${sheetLabel(locale, 'coverage.eligible')
        .replace('{eligible}', String(metric.eligibleRows))
        .replace('{total}', String(metric.totalRows))}; ${
        hasSheetLabel(coverageKey) ? sheetLabel(locale, coverageKey) : coverageKey
      }`,
      model.numberingSystem,
    );
    row.getCell(4).value = coverageText;
    row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    // Rows inside a table don't auto-fit in LibreOffice; give two-line
    // coverage strings an explicit height so they don't overlap.
    if (coverageText.length > 28) {
      row.height = 30;
    }
  }
  // Second pass: constant template formulas with the model's cached results.
  // Placements are complete, so cross-metric references always resolve.
  for (const metric of model.metrics) {
    if (metric.id.startsWith('quality-')) continue;
    const placement = placements.get(metric.id);
    if (placement === undefined) continue;
    const numeric = metric.value !== null ? toMetricCellValue(metric.value) : null;
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
    columns: kpiHeaders.map((name) => ({ name, filterButton: true })),
    rows: [],
  });
  styleHeaderRow(kpis.getRow(1), 4);
  kpis.autoFilter = { from: 'A1', to: `D${kpis.rowCount}` };
  kpis.pageSetup.fitToPage = true;
  kpis.pageSetup.fitToWidth = 1;
  kpis.pageSetup.fitToHeight = 0;
  kpis.pageSetup.printArea = `A1:D${kpis.rowCount}`;

  progress('tables', 0.75);

  // ---- Data Quality ----------------------------------------------------------
  const quality = get('quality');
  const issueHeaders = [
    'table.issue', 'table.kind', 'table.row', 'table.field', 'table.original',
    'table.normalized', 'table.status', 'table.action', 'table.approval',
  ].map((key) => sheetLabel(locale, key));
  const enumLabel = (prefix: string, id: string): string => {
    const key = `${prefix}.${id}`;
    return hasSheetLabel(key) ? sheetLabel(locale, key) : id;
  };
  quality.columns = [
    { header: issueHeaders[0]!, key: 'issue', width: 24 },
    { header: issueHeaders[1]!, key: 'kind', width: 14 },
    { header: issueHeaders[2]!, key: 'row', width: 10 },
    { header: issueHeaders[3]!, key: 'field', width: 18 },
    { header: issueHeaders[4]!, key: 'original', width: 20 },
    { header: issueHeaders[5]!, key: 'normalized', width: 20 },
    { header: issueHeaders[6]!, key: 'status', width: 12 },
    { header: issueHeaders[7]!, key: 'action', width: 14 },
    { header: issueHeaders[8]!, key: 'approval', width: 16 },
  ];
  model.table.qualityIssues.forEach((issue, index) => {
    quality.addRow({
      issue: formatCount(index + 1, model.numberingSystem),
      kind: enumLabel('quality.kind', issue.kind),
      row: issue.sourceRow,
      field: issue.fieldId ?? '',
      original: issue.original ?? '',
      normalized: issue.normalized ?? '',
      status: enumLabel('quality.status', issue.status),
      action: enumLabel('quality.action', issue.action),
      approval: enumLabel('quality.approval', issue.approval),
    });
  });
  quality.addTable({
    name: TABLE_NAMES['quality'] as string,
    ref: `A1:I${model.table.qualityIssues.length + 1}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: issueHeaders.map((name) => ({ name, filterButton: true })),
    rows: [],
  });
  styleHeaderRow(quality.getRow(1), 9);
  quality.autoFilter = { from: 'A1', to: `I${model.table.qualityIssues.length + 1}` };
  quality.pageSetup.printArea = `A1:I${model.table.qualityIssues.length + 1}`;
  // Restrained emphasis: unresolved rows read red, nothing else shouts.
  model.table.qualityIssues.forEach((issue, index) => {
    if (issue.status === 'unresolved') {
      const cell = quality.getRow(index + 2).getCell(7);
      cell.font = { color: { argb: ADVERSE_ARGB }, bold: true };
    }
  });

  // ---- Methodology -------------------------------------------------------------
  const method = get('methodology');
  // 'Proof <id>' labels run ~34 chars; LibreOffice clips at the column edge,
  // so the label column is sized for them rather than relying on overflow.
  // The pair must stay within ~74 units of portrait width or the detail
  // column spills onto its own page.
  method.columns = [{ width: 36 }, { width: 38 }];
  // Human-readable rows first; identifiers and engine internals sit under
  // a clearly marked diagnostics block below them.
  const methodRows: Array<[string, string]> = [
    [sheetLabel(locale, 'method.scope'), `${model.scope.periodStart ?? 'all'}..${model.scope.periodEnd ?? 'all'}`],
    [sheetLabel(locale, 'method.limits'), sheetLabel(locale, 'method.noForecast')],
    [sheetLabel(locale, 'sheet.diagnostics'), ''],
    [sheetLabel(locale, 'evidence.hash'), model.sourceHash],
    [sheetLabel(locale, 'method.policy'), '1.0.0'],
    [sheetLabel(locale, 'method.analysis'), model.analysisId],
    [sheetLabel(locale, 'method.revision'), model.table.normalizationRevision],
    [sheetLabel(locale, 'method.template'), '1.0.0'],
    ['Locale', `${model.locale} / ${model.numberingSystem}`],
    [sheetLabel(locale, 'method.precision'), sheetLabel(locale, 'method.precision.halfUp')],
  ];
  for (const proof of model.provenance) {
    const spans = proof.selections.map((s) => s.spans.map((span) => `${span.start}-${span.end}`).join(',')).join(';');
    methodRows.push([
      sheetLabel(locale, 'method.proof').replace('{id}', proof.id),
      `${JSON.stringify(proof.expression)} = ${proof.result ?? proof.reasonKey}${spans === '' ? '' : ` [${spans}]`}`,
    ]);
  }
  methodRows.forEach(([label, detail], i) => {
    const row = method.getRow(i + 1);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, color: { argb: MUTED_ARGB } };
    row.getCell(2).value = detail;
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    // Rows inside a table don't auto-fit in LibreOffice — size the row for
    // the wrapped detail text so it can't overlap or hide.
    const detailLines = Math.ceil(detail.length / 36);
    if (detailLines > 1) {
      row.height = 15 * detailLines;
    }
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
  method.pageSetup.fitToPage = true;
  method.pageSetup.fitToWidth = 1;
  method.pageSetup.fitToHeight = 0;
  method.pageSetup.printArea = `A1:B${methodRows.length}`;
  clean.pageSetup.printArea = `A1:${columnLetter(headers.length)}${model.table.rows.length + 1}`;

  progress('package', null);
  // writeBuffer resolves to a byte array (Uint8Array in browsers); the
  // metadata travels in the message while these bytes travel out of band.
  const raw = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
  const repaired = await repairWorkbookXml(raw, {
    [TABLE_NAMES['clean'] as string]: `A1:${columnLetter(headers.length)}${model.table.rows.length + 1}`,
    [TABLE_NAMES['quality'] as string]: `A1:I${model.table.qualityIssues.length + 1}`,
    [TABLE_NAMES['kpis'] as string]: `A1:D${kpis.rowCount}`,
    [TABLE_NAMES['methodology'] as string]: `A1:B${methodRows.length}`,
  });
  const view = repaired.byteOffset === 0 && repaired.byteLength === repaired.buffer.byteLength
    ? new Uint8Array(repaired.buffer as ArrayBuffer)
    : new Uint8Array(repaired.buffer as ArrayBuffer, repaired.byteOffset, repaired.byteLength);
  const bytes = view.slice().buffer;
  const sha256 = await sha256Hex(new Uint8Array(bytes));
  progress('ready', 1);
  return {
    metadata: {
      exportId: model.exportId,
      format: 'xlsx',
      mime: MIME,
      filename: exportFileName(model, 'xlsx'),
      byteLength: bytes.byteLength,
      sha256,
      binarySlot: 'workbook',
    },
    bytes,
  };
};

/**
 * Post-package repairs for exceljs 4.4 output defects.
 *
 * 1. A table part's emitted ref is derived from the `rows` array passed to
 *    `addTable`, not from cells already laid out with `addRow`/`getRow` — so
 *    every table ref covers only its header (or nothing, when headerRow is
 *    off). Excel's repair drops the tables and their filters. Rewrite each
 *    table part's ref — and its internal autoFilter ref — to the range the
 *    writer actually laid out.
 * 2. `legacyDrawing` (the VML payload for cell notes) is emitted after
 *    `tableParts`, violating the worksheet schema order; strict parsers
 *    discard the whole sheet. Move those nodes ahead of `tableParts`.
 */
async function repairWorkbookXml(
  buffer: Uint8Array,
  tableRefs: Record<string, string>,
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(buffer);
  const tablePaths = Object.keys(zip.files).filter((p) => /^xl\/tables\/table\d+\.xml$/.test(p));
  for (const path of tablePaths) {
    const file = zip.file(path);
    if (file === null) continue;
    const xml = await file.async('string');
    const name = /<table[^>]*\bname="([^"]+)"/.exec(xml)?.[1];
    const ref = name === undefined ? undefined : tableRefs[name];
    if (ref === undefined) continue;
    zip.file(path, xml.replace(/\bref="[^"]*"/g, `ref="${ref}"`));
  }
  const sheetPaths = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
  for (const path of sheetPaths) {
    const file = zip.file(path);
    if (file === null) continue;
    const xml = await file.async('string');
    const legacyNodes = xml.match(/<legacyDrawing[^/]*\/>/g) ?? [];
    if (legacyNodes.length === 0 || !xml.includes('<tableParts')) continue;
    const stripped = xml.replace(/<legacyDrawing[^/]*\/>/g, '');
    zip.file(path, stripped.replace('<tableParts', `${legacyNodes.join('')}<tableParts`));
  }
  return zip.generateAsync({ type: 'uint8array' });
}

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
