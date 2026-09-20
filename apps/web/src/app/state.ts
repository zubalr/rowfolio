import type {
  AnalysisSnapshot,
  Column,
  Decimal,
  ExportArtifact,
  ExportModel,
  Finding,
  Hash,
  Locale,
  NormalizedTable,
  QualityIssue,
  RawTable,
  ScenarioResult,
} from '@rowfolio/contracts';

/** Structural twin of ingest's SourceInspection (deep imports are banned). */
export interface SheetInfo {
  sheetId: string;
  ordinal: number;
  name: string;
  visibility: 'visible' | 'hidden' | 'very-hidden';
  dimensions: { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number } | null;
}

export interface SourceInspection {
  format: 'xlsx' | 'csv';
  sourceName: string;
  sourceHash: string;
  sheets: SheetInfo[];
  defaultSheetId: string | null;
  hiddenSheets: SheetInfo[];
}

export type Phase = 'idle' | 'reading' | 'profiling' | 'needsReview' | 'analyzing' | 'ready' | 'exporting';

export type SourceKind = 'sample' | 'upload';

export interface SourceMeta {
  name: string;
  format: 'xlsx' | 'csv';
  byteLength: number;
  /** Verified SHA-256 of source bytes once known. */
  hash: Hash | null;
}

export interface CommittedDataset {
  source: SourceMeta & { hash: Hash };
  table: NormalizedTable;
  snapshot: AnalysisSnapshot;
}

export interface PendingSource {
  kind: SourceKind;
  source: SourceMeta;
  inspection: SourceInspection | null;
  rawTable: RawTable | null;
  proposedColumns: Column[] | null;
  issues: QualityIssue[] | null;
  stage: string | null;
  fraction: number | null;
}

export type ExportFormat = 'xlsx' | 'pptx';

export interface ExportArtifactEntry {
  artifact: ExportArtifact;
  /** Object URL for the download link; revoked on clear/replace. */
  url: string;
}

export interface ExportState {
  open: boolean;
  building: boolean;
  stage: string | null;
  model: ExportModel | null;
  artifacts: Partial<Record<ExportFormat, ExportArtifactEntry>>;
  failure: { format: ExportFormat; code: string; messageKey: string } | null;
  /** Identity of the committed inputs the artifacts bind to. */
  scenarioId: string | null;
  locale: Locale | null;
  /** Session revision the build began on; commits are dropped once it no longer matches. */
  epoch: number;
}

export interface SessionError {
  code: string;
  messageKey: string;
  recoverable: boolean;
}

export type Notice = 'upload.previousRetained';

export interface SessionState {
  sessionId: string;
  /** Revision guard — bumped each time a new source begins. */
  revision: number;
  phase: Phase;
  active: CommittedDataset | null;
  pending: PendingSource | null;
  /** requestId of the in-flight analysis-worker request (guard echo). */
  requestId: string | null;
  error: SessionError | null;
  notice: Notice | null;
  selectedFindingId: string | null;
  evidenceOpen: boolean;
  evidenceFindingId: string | null;
  /** Typed scenario input (display string). */
  scenarioInput: string;
  /** In-flight scenario costChange (fraction decimal) + its request guard. */
  scenarioRequest: Decimal | null;
  scenarioRequestId: string | null;
  /** Committed scenario result — the only scenario state export/UI may use. */
  scenario: ScenarioResult | null;
  export: ExportState;
}

export function initialSession(sessionId: string): SessionState {
  return {
    sessionId,
    revision: 0,
    phase: 'idle',
    active: null,
    pending: null,
    requestId: null,
    error: null,
    notice: null,
    selectedFindingId: null,
    evidenceOpen: false,
    evidenceFindingId: null,
    scenarioInput: '',
    scenarioRequest: null,
    scenarioRequestId: null,
    scenario: null,
    export: {
      open: false,
      building: false,
      stage: null,
      model: null,
      artifacts: {},
      failure: null,
      scenarioId: null,
      locale: null,
      epoch: -1,
    },
  };
}

export function findingById(snapshot: AnalysisSnapshot | null, id: string | null): Finding | null {
  if (!snapshot || !id) return null;
  return snapshot.findings.find((f) => f.id === id) ?? null;
}
