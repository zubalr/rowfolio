/**
 * Public types for the upload review flow (apps/web/src/upload).
 *
 * `ParseOptions`, `ApprovalPlan`, `Progress` and the port signatures are
 * structural twins of the declaration-only contract surface in
 * packages/contracts/src/interfaces.ts (that module is not importable across
 * the package boundary, so the identical shapes are declared here — the same
 * pattern packages/ingest uses; contract tests assert assignability).
 */
import type { Column, Hash, QualityIssue, RawTable } from "@rowfolio/contracts";
import type { IngestExtras, SourceInspection } from "@rowfolio/ingest";

/** Contract ParseOptions — physical, 1-based coordinates; see INTERFACES.md. */
export interface ParseOptions {
  selectedSheetId?: string;
  headerRow?: number;
  firstColumn?: number;
  lastColumn?: number;
  allowHiddenSheet: boolean;
}

/** Contract ApprovalPlan — explicit user decisions handed to normalization. */
export interface ApprovalPlan {
  issueIds: readonly string[];
  columns: readonly Column[];
  useUnverifiedFormulaCaches: readonly string[];
}

/** Stage progress callback; fraction is null when the amount of work is unknown. */
export type Progress = (stage: string, fraction: number | null) => void;

/** CSV delimiter candidates per spec 15 (comma, tab, semicolon). */
export type CsvDelimiter = "," | "\t" | ";";

/** Structured profile output — contract ProfileTable signature (packages/normalize). */
export type ProfileTable = (raw: RawTable) => {
  proposedColumns: Column[];
  issues: QualityIssue[];
} | Promise<{
  proposedColumns: Column[];
  issues: QualityIssue[];
}>;

/**
 * External capabilities the flow needs. `inspect`/`parse` are bound to the
 * real `@rowfolio/ingest` adapters by `ingestPorts()` in adapters.ts; a host
 * may substitute worker-transport equivalents with identical signatures.
 * `profile` has no default: the composition root wires it to the worker
 * (`profile` op) so profiling never blocks the main thread.
 */
export interface UploadPorts {
  inspect(
    bytes: ArrayBuffer,
    sourceName: string,
    options?: Partial<ParseOptions> & IngestExtras,
    progress?: Progress,
  ): Promise<SourceInspection>;
  parse(
    bytes: ArrayBuffer,
    sourceName: string,
    options: ParseOptions,
    progress?: Progress,
    extras?: IngestExtras,
  ): Promise<RawTable>;
  profile: ProfileTable;
}

/** A user-chosen source file retained in memory for retry. Never persisted. */
export interface UploadFileRef {
  readonly name: string;
  readonly bytes: ArrayBuffer;
  readonly byteLength: number;
}

/** Typed failure shown on the error surface; code maps to `error.<CODE>` keys. */
export interface UploadFailure {
  readonly code:
    | "INVALID_FILE"
    | "LIMIT_EXCEEDED"
    | "AMBIGUOUS_INPUT"
    | "UNSUPPORTED"
    | "CANCELLED"
    | "TIMEOUT"
    | "EXPORT_FAILED"
    | "SCHEMA_MISMATCH"
    | "INTERNAL";
  /** Stable machine-readable qualifier (e.g. `zip.encrypted-entry`); never source content. */
  readonly detail: string;
  readonly recoverable: boolean;
}

/** What the user confirmed on the table-selection screen. */
export interface UploadSelection {
  readonly selectedSheetId?: string;
  readonly headerRow?: number;
  readonly firstColumn?: number;
  readonly lastColumn?: number;
  readonly allowHiddenSheet: boolean;
  /** Set only after the user resolves a CSV delimiter ambiguity. */
  readonly delimiter?: CsvDelimiter;
}

/** In-progress named stage + last reported fraction (null = indeterminate). */
export interface UploadProgress {
  readonly stage: string;
  readonly fraction: number | null;
}

/**
 * Review decisions collected before normalization. Sets hold IDs/field IDs.
 * `columnOverrides[columnId]` is a full replacement Column the user chose
 * (e.g. confirmed-as-proposed, or downgraded to unconfirmed-safe text).
 */
export interface UploadDecisions {
  readonly approvedIssueIds: ReadonlySet<string>;
  readonly columnOverrides: ReadonlyMap<string, Column>;
  readonly cacheColumns: ReadonlySet<string>;
}

/** The committed result: everything downstream (normalize op) needs. */
export interface UploadOutcome {
  readonly table: RawTable;
  readonly inspection: SourceInspection;
  readonly parseOptions: ParseOptions;
  readonly approvalPlan: ApprovalPlan;
  readonly sourceHash: Hash;
}

/** Discriminated upload-flow state; `prior` preserves the last valid outcome. */
export type UploadState =
  | { readonly stage: "idle"; readonly prior: UploadOutcome | null }
  | {
      readonly stage: "inspecting";
      readonly file: UploadFileRef;
      readonly prior: UploadOutcome | null;
      readonly progress: UploadProgress | null;
    }
  | {
      readonly stage: "configure";
      readonly file: UploadFileRef;
      readonly prior: UploadOutcome | null;
      /** Null while a delimiter ambiguity blocks even bounded inspection. */
      readonly inspection: SourceInspection | null;
      readonly selection: UploadSelection;
      /** True when CSV delimiter detection was ambiguous and awaits a choice. */
      readonly needsDelimiter: boolean;
      /** Sheet ids the user has explicitly opted into (hidden sheets). */
      readonly optedHiddenSheets: ReadonlySet<string>;
      readonly progress: UploadProgress | null;
    }
  | {
      readonly stage: "parsing";
      readonly file: UploadFileRef;
      readonly prior: UploadOutcome | null;
      readonly inspection: SourceInspection;
      readonly selection: UploadSelection;
      readonly progress: UploadProgress | null;
    }
  | {
      readonly stage: "review";
      readonly file: UploadFileRef;
      readonly prior: UploadOutcome | null;
      readonly inspection: SourceInspection;
      readonly selection: UploadSelection;
      readonly table: RawTable;
      readonly proposedColumns: readonly Column[];
      readonly issues: readonly QualityIssue[];
      readonly decisions: UploadDecisions;
      readonly optedHiddenSheets: ReadonlySet<string>;
    }
  | {
      readonly stage: "confirm-replace";
      readonly file: UploadFileRef;
      readonly prior: UploadOutcome;
    }
  | {
      readonly stage: "error";
      readonly file: UploadFileRef;
      readonly prior: UploadOutcome | null;
      readonly failure: UploadFailure;
      /** Which step `retry()` re-runs. */
      readonly retryStep: "inspect" | "parse";
      readonly inspection?: SourceInspection;
      readonly selection?: UploadSelection;
    };

export interface UploadControllerCallbacks {
  /** Called once when the user applies the reviewed plan. */
  onComplete?: (outcome: UploadOutcome) => void;
  /** Called on every state transition (React binding + tests). */
  onChange?: (state: UploadState) => void;
}

export interface UploadController {
  /** Current immutable state snapshot. */
  getState(): UploadState;
  subscribe(listener: (state: UploadState) => void): () => void;
  /** Pick a new source file. Requires confirmation when a committed session exists. */
  acceptFile(bytes: ArrayBuffer, name: string): void;
  /** confirm-replace stage. */
  confirmReplace(): void;
  declineReplace(): void;
  /** Pick a sheet (visible or explicitly opted-in hidden sheet). */
  selectSheet(sheetId: string): void;
  /** Grant the hidden-sheet opt-in for one sheet, then select it. */
  optIntoHiddenSheet(sheetId: string): void;
  /** Withdraw a hidden-sheet opt-in (also deselects that sheet). */
  revokeHiddenSheet(sheetId: string): void;
  /** Resolve a CSV delimiter ambiguity; re-inspects with the choice. */
  chooseDelimiter(delimiter: CsvDelimiter): void;
  /** Set the physical header row (undefined = parser default). */
  setHeaderRow(row: number | undefined): void;
  /** configure → parsing → review. */
  proceed(): void;
  /** Review-stage decisions. */
  toggleIssue(issueId: string, approved: boolean): void;
  confirmColumn(columnId: string): void;
  downgradeColumnToText(columnId: string): void;
  toggleFormulaCache(fieldId: string, enabled: boolean): void;
  /** Back from review to the configure step (selection preserved). */
  editSelection(): void;
  /** Emit the outcome and return to idle with it as `prior`. */
  submit(): void;
  /** Abort in-flight work and return to source selection (prior kept). */
  cancel(): void;
  /** Re-run the failed step after an error. */
  retry(): void;
  /** Abandon the flow entirely (drops prior too — called by clear-session). */
  reset(): void;
}
