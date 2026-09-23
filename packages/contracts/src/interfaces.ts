/**
 * Cross-package public signatures (INTERFACES.md §"Package entry points").
 *
 * These are declaration-only types: implementations live in their owning
 * packages (ingest, normalize, provenance, analysis, scenario, export-*),
 * but every package implements against this exact contract surface. Binary
 * data is always transferred out of band — never inside JSON. `Decimal`
 * in signatures is the canonical decimal STRING type, not a Decimal.js
 * instance.
 */
import type {
  AnalysisSnapshot,
  Column,
  Decimal,
  ExportArtifact,
  ExportModel,
  Locale,
  Metric,
  NormalizedRow,
  NormalizedTable,
  Provenance,
  QualityIssue,
  RawTable,
  RowSelection,
  ScenarioDefinition,
  ScenarioResult,
  Scope,
} from './types.ts';

export type { Decimal };

/** Binary payloads carried next to a validated message — keyed by declared slot name. */
export type BinarySlots = ReadonlyMap<string, ArrayBuffer>;

/** Stage progress callback; fraction is null when the amount of work is unknown. */
export type Progress = (stage: string, fraction: number | null) => void;

/** packages/ingest — worker entry supervises timeout/cancellation. */
export interface ParseOptions {
  selectedSheetId?: string;
  headerRow?: number;
  firstColumn?: number;
  lastColumn?: number;
  allowHiddenSheet: boolean;
}

/** packages/normalize — explicit user/manifest approvals drive the transform plan. */
export interface ApprovalPlan {
  issueIds: readonly string[];
  columns: readonly Column[];
  useUnverifiedFormulaCaches: readonly string[];
}

export interface AnalysisOptions {
  version: '1.0.0';
  confirmedScope: Scope;
  samplePolicyId: string | null;
}

export interface EvidencePage {
  rows: readonly NormalizedRow[];
  offset: number;
  total: number;
  nextOffset: number | null;
}

/** Native build output: metadata travels in the message, `bytes` out of band. */
export interface BuiltArtifact {
  metadata: ExportArtifact;
  bytes: ArrayBuffer;
}

// packages/ingest
export type ParseSource = (bytes: ArrayBuffer, sourceName: string, options: ParseOptions, progress: Progress) => Promise<RawTable>;

// packages/normalize
export type ProfileTable = (raw: RawTable) => { proposedColumns: Column[]; issues: QualityIssue[] };
export type NormalizeTable = (raw: RawTable, approvals: ApprovalPlan) => NormalizedTable;

// packages/provenance
export type EvaluateProof = (proof: Provenance, table: NormalizedTable, metrics: readonly Metric[]) => { value: Decimal | null; reasonKey: string | null };
export type ReadEvidencePage = (table: NormalizedTable, selection: RowSelection, offset: number, pageSize: number) => EvidencePage;

// packages/analysis
export type Analyze = (table: NormalizedTable, options: AnalysisOptions) => AnalysisSnapshot;

// packages/scenario
export type RunScenario = (snapshot: AnalysisSnapshot, definition: ScenarioDefinition, costChange: Decimal) => ScenarioResult;

// packages/export-model
export type BuildExportModel = (
  snapshot: AnalysisSnapshot,
  table: NormalizedTable,
  scenario: ScenarioResult | null,
  locale: Locale,
  numberingSystem: 'latn' | 'arab',
  createdAt: string,
) => ExportModel;

// packages/export-xlsx and packages/export-pptx
export type BuildWorkbook = (model: ExportModel, progress: Progress) => Promise<BuiltArtifact>;
export type BuildPresentation = (model: ExportModel, progress: Progress) => Promise<BuiltArtifact>;
