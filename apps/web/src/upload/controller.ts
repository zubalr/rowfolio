/**
 * Upload-flow controller — a framework-free state machine.
 *
 * Stages: idle → inspecting → configure → parsing → review → (submit) idle.
 * A committed `UploadOutcome` is kept as `prior` through every later stage and
 * survives failures — an unsupported or cancelled file never destroys a valid
 * session (spec 15; 02_PRODUCT_SPEC.md states).
 *
 * Concurrency: every async step carries a monotonically increasing job id and
 * an AbortSignal; late completions are ignored (the request/revision guard in
 * INTERFACES.md, applied at the UI seam). `cancel()` aborts cooperatively and
 * returns to source selection — a host running the ports inside a worker must
 * additionally terminate that worker; the controller already discards the
 * result either way.
 */
import type {
  ApprovalPlan,
  CsvDelimiter,
  ParseOptions,
  Progress,
  UploadController,
  UploadControllerCallbacks,
  UploadDecisions,
  UploadFailure,
  UploadFileRef,
  UploadOutcome,
  UploadPorts,
  UploadSelection,
  UploadState,
} from "./types.ts";
import { toWorkerError } from "@rowfolio/ingest";
import type { SourceInspection } from "@rowfolio/ingest";
import type { Column, QualityIssue } from "@rowfolio/contracts";

const emptyDecisions = (): UploadDecisions => ({
  approvedIssueIds: new Set<string>(),
  columnOverrides: new Map<string, Column>(),
  cacheColumns: new Set<string>(),
});

function toFailure(error: unknown): UploadFailure {
  const mapped = toWorkerError(error);
  return {
    code: mapped.code,
    detail: mapped.detail,
    recoverable: mapped.recoverable,
  };
}

function toParseOptions(selection: UploadSelection): ParseOptions {
  return {
    allowHiddenSheet: selection.allowHiddenSheet,
    ...(selection.selectedSheetId !== undefined
      ? { selectedSheetId: selection.selectedSheetId }
      : {}),
    ...(selection.headerRow !== undefined ? { headerRow: selection.headerRow } : {}),
    ...(selection.firstColumn !== undefined ? { firstColumn: selection.firstColumn } : {}),
    ...(selection.lastColumn !== undefined ? { lastColumn: selection.lastColumn } : {}),
  };
}

export function createUploadController(
  ports: UploadPorts,
  callbacks: UploadControllerCallbacks = {},
): UploadController {
  let state: UploadState = { stage: "idle", prior: null };
  let jobSeq = 0;
  let abort: AbortController | null = null;
  const listeners = new Set<(state: UploadState) => void>();

  const emit = (next: UploadState) => {
    state = next;
    callbacks.onChange?.(next);
    for (const listener of [...listeners]) listener(next);
  };

  const newJob = () => {
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    jobSeq += 1;
    return { id: jobSeq, signal: controller.signal };
  };

  const progressFor = (jobId: number, apply: (p: { stage: string; fraction: number | null }) => void): Progress =>
    (stage, fraction) => {
      if (jobId !== jobSeq) return; // stale progress from a superseded job
      apply({ stage, fraction });
    };

  async function runInspect(job: { id: number; signal: AbortSignal }, file: UploadFileRef, options: Partial<ParseOptions> & { delimiter?: CsvDelimiter }, optedHiddenSheets: ReadonlySet<string>, prior: UploadOutcome | null): Promise<void> {
    const signal = job.signal;
    const progress = progressFor(job.id, (p) => {
      if (state.stage === "inspecting" || state.stage === "configure") {
        emit({ ...state, progress: p });
      }
    });
    try {
      const inspection = await ports.inspect(
        file.bytes,
        file.name,
        {
          allowHiddenSheet: options.allowHiddenSheet ?? false,
          ...(options.selectedSheetId !== undefined ? { selectedSheetId: options.selectedSheetId } : {}),
          ...(options.headerRow !== undefined ? { headerRow: options.headerRow } : {}),
          signal,
          ...(options.delimiter !== undefined ? { delimiter: options.delimiter } : {}),
        },
        progress,
      );
      if (job.id !== jobSeq || signal.aborted) return;
      const selectedSheetId = options.selectedSheetId ?? inspection.defaultSheetId ?? undefined;
      const selected = inspection.sheets.find((s) => s.sheetId === selectedSheetId);
      emit({
        stage: "configure",
        file,
        prior,
        inspection,
        selection: {
          allowHiddenSheet: selected !== undefined && selected.visibility !== "visible",
          ...(selectedSheetId !== undefined ? { selectedSheetId } : {}),
          ...(options.headerRow !== undefined ? { headerRow: options.headerRow } : {}),
          ...(options.delimiter !== undefined ? { delimiter: options.delimiter } : {}),
        },
        needsDelimiter: false,
        optedHiddenSheets,
        progress: null,
      });
    } catch (error) {
      if (job.id !== jobSeq) return;
      if (signal.aborted) return;
      const failure = toFailure(error);
      if (failure.code === "AMBIGUOUS_INPUT" && failure.detail === "csv.ambiguous-delimiter") {
        emit({
          stage: "configure",
          file,
          prior,
          inspection: null,
          selection: {
            allowHiddenSheet: false,
            ...(options.selectedSheetId !== undefined ? { selectedSheetId: options.selectedSheetId } : {}),
          },
          needsDelimiter: true,
          optedHiddenSheets,
          progress: null,
        });
        return;
      }
      if (failure.code === "CANCELLED") {
        emit({ stage: "idle", prior });
        return;
      }
      emit({ stage: "error", file, prior, failure, retryStep: "inspect" });
    }
  }

  async function runParse(job: { id: number; signal: AbortSignal }, file: UploadFileRef, selection: UploadSelection, inspection: SourceInspection, prior: UploadOutcome | null, optedHiddenSheets: ReadonlySet<string>): Promise<void> {
    const signal = job.signal;
    const options = toParseOptions(selection);
    try {
      const table = await ports.parse(
        file.bytes,
        file.name,
        options,
        progressFor(job.id, (p) => {
          if (state.stage === "parsing") emit({ ...state, progress: p });
        }),
        {
          signal,
          ...(selection.delimiter !== undefined ? { delimiter: selection.delimiter } : {}),
        },
      );
      if (job.id !== jobSeq || signal.aborted) return;
      let profiled: { proposedColumns: Column[]; issues: QualityIssue[] };
      try {
        profiled = await ports.profile(table);
      } catch (error) {
        emit({ stage: "error", file, prior, failure: toFailure(error), retryStep: "parse", inspection, selection });
        return;
      }
      emit({
        stage: "review",
        file,
        prior,
        inspection,
        selection,
        table,
        proposedColumns: profiled.proposedColumns,
        issues: profiled.issues,
        decisions: emptyDecisions(),
        optedHiddenSheets,
      });
    } catch (error) {
      if (job.id !== jobSeq) return;
      if (signal.aborted) return;
      const failure = toFailure(error);
      if (failure.code === "CANCELLED") {
        emit({ stage: "idle", prior });
        return;
      }
      emit({ stage: "error", file, prior, failure, retryStep: "parse", inspection, selection });
    }
  }

  const controller: UploadController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    acceptFile(bytes, name) {
      const file: UploadFileRef = { name, bytes, byteLength: bytes.byteLength };
      const prior = state.prior;
      if (prior !== null) {
        emit({ stage: "confirm-replace", file, prior });
        return;
      }
      const job = newJob();
      emit({ stage: "inspecting", file, prior, progress: null });
      void runInspect(job, file, { allowHiddenSheet: false }, new Set(), prior);
    },

    confirmReplace() {
      if (state.stage !== "confirm-replace") return;
      const { file, prior } = state;
      const job = newJob();
      emit({ stage: "inspecting", file, prior, progress: null });
      void runInspect(job, file, { allowHiddenSheet: false }, new Set(), prior);
    },

    declineReplace() {
      if (state.stage !== "confirm-replace") return;
      emit({ stage: "idle", prior: state.prior });
    },

    selectSheet(sheetId) {
      if (state.stage !== "configure" || state.inspection === null) return;
      const sheet = state.inspection.sheets.find((s) => s.sheetId === sheetId);
      if (!sheet) return;
      if (sheet.visibility !== "visible" && !state.optedHiddenSheets.has(sheetId)) return;
      const { file, prior, optedHiddenSheets } = state;
      const rest = { ...state.selection };
      delete rest.headerRow;
      const selection: UploadSelection = {
        ...rest,
        selectedSheetId: sheetId,
        allowHiddenSheet: sheet.visibility !== "visible",
      };
      const job = newJob();
      emit({ ...state, selection, progress: { stage: "inspect", fraction: null } });
      void runInspect(
        job,
        file,
        {
          allowHiddenSheet: selection.allowHiddenSheet,
          selectedSheetId: sheetId,
          ...(selection.delimiter !== undefined ? { delimiter: selection.delimiter } : {}),
        },
        optedHiddenSheets,
        prior,
      );
    },

    optIntoHiddenSheet(sheetId) {
      if (state.stage !== "configure" || state.inspection === null) return;
      const sheet = state.inspection.sheets.find((s) => s.sheetId === sheetId);
      if (!sheet || sheet.visibility === "visible") return;
      const opted = new Set(state.optedHiddenSheets);
      opted.add(sheetId);
      emit({ ...state, optedHiddenSheets: opted });
    },

    revokeHiddenSheet(sheetId) {
      if (state.stage !== "configure" || state.inspection === null) return;
      const opted = new Set(state.optedHiddenSheets);
      if (!opted.delete(sheetId)) return;
      if (state.selection.selectedSheetId === sheetId) {
        const fallback = state.inspection.defaultSheetId;
        const rest = { ...state.selection };
        delete rest.selectedSheetId;
        emit({
          ...state,
          optedHiddenSheets: opted,
          selection: {
            ...rest,
            allowHiddenSheet: false,
            ...(fallback !== null ? { selectedSheetId: fallback } : {}),
          },
        });
        return;
      }
      emit({ ...state, optedHiddenSheets: opted });
    },

    chooseDelimiter(delimiter) {
      if (state.stage !== "configure") return;
      const { file, prior, optedHiddenSheets } = state;
      const job = newJob();
      emit({ ...state, progress: { stage: "inspect", fraction: null } });
      void runInspect(job, file, { allowHiddenSheet: false, delimiter }, optedHiddenSheets, prior);
    },

    setHeaderRow(row) {
      if (state.stage !== "configure") return;
      const rest = { ...state.selection };
      delete rest.headerRow;
      emit({
        ...state,
        selection: row === undefined ? rest : { ...rest, headerRow: row },
      });
    },

    proceed() {
      if (state.stage !== "configure" || state.inspection === null || state.needsDelimiter) return;
      const { file, prior, inspection, selection, optedHiddenSheets } = state;
      const job = newJob();
      emit({ stage: "parsing", file, prior, inspection, selection, progress: null });
      void runParse(job, file, selection, inspection, prior, optedHiddenSheets);
    },

    toggleIssue(issueId, approved) {
      if (state.stage !== "review") return;
      const approvedIssueIds = new Set(state.decisions.approvedIssueIds);
      if (approved) approvedIssueIds.add(issueId);
      else approvedIssueIds.delete(issueId);
      emit({ ...state, decisions: { ...state.decisions, approvedIssueIds } });
    },

    confirmColumn(columnId) {
      if (state.stage !== "review") return;
      const column = state.proposedColumns.find((c) => c.id === columnId);
      if (!column) return;
      const columnOverrides = new Map(state.decisions.columnOverrides);
      columnOverrides.set(columnId, { ...column, confirmed: true });
      // Confirming a proposed interpretation also approves its linked
      // confirm-type issues (e.g. ambiguous-date on this field).
      const approvedIssueIds = new Set(state.decisions.approvedIssueIds);
      for (const issue of state.issues) {
        if (issue.fieldId === columnId && issue.action === "confirm-type") {
          approvedIssueIds.add(issue.id);
        }
      }
      emit({ ...state, decisions: { ...state.decisions, columnOverrides, approvedIssueIds } });
    },

    downgradeColumnToText(columnId) {
      if (state.stage !== "review") return;
      const column = state.proposedColumns.find((c) => c.id === columnId);
      if (!column) return;
      const columnOverrides = new Map(state.decisions.columnOverrides);
      columnOverrides.set(columnId, {
        ...column,
        type: "text",
        role: "unknown",
        additive: false,
        confirmed: true,
      });
      // Refusing a proposed interpretation never approves its issues.
      const approvedIssueIds = new Set(state.decisions.approvedIssueIds);
      for (const issue of state.issues) {
        if (issue.fieldId === columnId && issue.action === "confirm-type") {
          approvedIssueIds.delete(issue.id);
        }
      }
      emit({ ...state, decisions: { ...state.decisions, columnOverrides, approvedIssueIds } });
    },

    toggleFormulaCache(fieldId, enabled) {
      if (state.stage !== "review") return;
      const cacheColumns = new Set(state.decisions.cacheColumns);
      const approvedIssueIds = new Set(state.decisions.approvedIssueIds);
      if (enabled) {
        cacheColumns.add(fieldId);
        for (const issue of state.issues) {
          if (issue.fieldId === fieldId && issue.action === "use-cache") {
            approvedIssueIds.add(issue.id);
          }
        }
      } else {
        cacheColumns.delete(fieldId);
        for (const issue of state.issues) {
          if (issue.fieldId === fieldId && issue.action === "use-cache") {
            approvedIssueIds.delete(issue.id);
          }
        }
      }
      emit({ ...state, decisions: { ...state.decisions, cacheColumns, approvedIssueIds } });
    },

    editSelection() {
      if (state.stage !== "review") return;
      const { file, prior, inspection, selection, optedHiddenSheets } = state;
      emit({
        stage: "configure",
        file,
        prior,
        inspection,
        selection,
        needsDelimiter: false,
        optedHiddenSheets,
        progress: null,
      });
    },

    submit() {
      if (state.stage !== "review") return;
      const { inspection, selection, table, proposedColumns, issues, decisions } = state;
      const columns = proposedColumns.map((c) => decisions.columnOverrides.get(c.id) ?? c);
      const approvalPlan: ApprovalPlan = {
        issueIds: [...decisions.approvedIssueIds].filter((id) => issues.some((i) => i.id === id)),
        columns,
        useUnverifiedFormulaCaches: [...decisions.cacheColumns],
      };
      const outcome: UploadOutcome = {
        table,
        inspection,
        parseOptions: toParseOptions(selection),
        approvalPlan,
        sourceHash: inspection.sourceHash,
      };
      emit({ stage: "idle", prior: outcome });
      callbacks.onComplete?.(outcome);
    },

    cancel() {
      abort?.abort();
      jobSeq += 1;
      emit({ stage: "idle", prior: state.prior });
    },

    retry() {
      if (state.stage !== "error") return;
      const { file, prior, retryStep } = state;
      const job = newJob();
      if (retryStep === "inspect") {
        emit({ stage: "inspecting", file, prior, progress: null });
        void runInspect(job, file, { allowHiddenSheet: false }, new Set(), prior);
      } else {
        const inspection = state.inspection;
        const selection = state.selection;
        if (!inspection || !selection) {
          emit({ stage: "inspecting", file, prior, progress: null });
          void runInspect(job, file, { allowHiddenSheet: false }, new Set(), prior);
          return;
        }
        emit({ stage: "parsing", file, prior, inspection, selection, progress: null });
        void runParse(job, file, selection, inspection, prior, new Set());
      }
    },

    reset() {
      abort?.abort();
      jobSeq += 1;
      emit({ stage: "idle", prior: null });
    },
  };

  return controller;
}
