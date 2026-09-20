import type {
  AnalysisSnapshot,
  Column,
  Decimal,
  ExportModel,
  Hash,
  NormalizedTable,
  QualityIssue,
  RawTable,
} from '@rowfolio/contracts';
import {
  initialSession,
  type ExportArtifactEntry,
  type ExportFormat,
  type PendingSource,
  type SessionError,
  type SessionState,
  type SourceInspection,
  type SourceKind,
  type SourceMeta,
} from './state.ts';

export type SessionAction =
  | { type: 'source.begin'; kind: SourceKind; source: SourceMeta }
  | { type: 'source.verified'; requestId: string; hash: Hash; byteLength: number }
  | { type: 'source.inspected'; requestId: string; inspection: SourceInspection; hash: Hash; byteLength: number }
  | { type: 'worker.progress'; requestId: string; stage: string; fraction: number | null }
  | { type: 'ingest.done'; requestId: string; rawTable: RawTable }
  | { type: 'profile.done'; requestId: string; columns: Column[]; issues: QualityIssue[] }
  | { type: 'analyze.done'; requestId: string; sourceHash: Hash; table: NormalizedTable; snapshot: AnalysisSnapshot }
  | { type: 'request.failed'; requestId: string; error: SessionError }
  | { type: 'request.cancelled'; requestId: string }
  | { type: 'request.start'; requestId: string }
  | { type: 'review.approve'; requestId: string }
  | { type: 'finding.select'; findingId: string }
  | { type: 'finding.clear' }
  | { type: 'evidence.open'; findingId: string }
  | { type: 'evidence.close' }
  | { type: 'scenario.input'; text: string }
  | { type: 'scenario.submit'; requestId: string; costChange: Decimal }
  | { type: 'scenario.done'; requestId: string; costChange: Decimal; result: import('@rowfolio/contracts').ScenarioResult }
  | { type: 'scenario.failed'; requestId: string; error: SessionError }
  | { type: 'scenario.reset' }
  | { type: 'export.open' }
  | { type: 'export.close' }
  | { type: 'export.begin'; model: ExportModel }
  | { type: 'export.progress'; stage: string; fraction: number | null }
  | { type: 'export.done'; format: ExportFormat; entry: ExportArtifactEntry }
  | { type: 'export.failed'; format: ExportFormat; code: string; messageKey: string }
  | { type: 'export.finished' }
  | { type: 'session.clear'; sessionId: string }
  | { type: 'session.replay' };

function isCurrent(state: SessionState, requestId: string): boolean {
  return state.requestId === requestId;
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'source.begin': {
      // A new source supersedes any in-flight work: bump the revision guard,
      // keep the prior committed dataset until the new one actually commits
      // (a failed upload must never destroy a valid session).
      return {
        ...state,
        revision: state.revision + 1,
        phase: 'reading',
        pending: {
          kind: action.kind,
          source: action.source,
          inspection: null,
          rawTable: null,
          proposedColumns: null,
          issues: null,
          stage: 'preflight',
          fraction: null,
        },
        requestId: null,
        error: null,
        notice: null,
        evidenceOpen: false,
      };
    }

    case 'request.start':
      return { ...state, requestId: action.requestId };

    case 'source.verified': {
      if (!isCurrent(state, action.requestId) || !state.pending) return state;
      return {
        ...state,
        pending: {
          ...state.pending,
          source: { ...state.pending.source, hash: action.hash, byteLength: action.byteLength },
        },
      };
    }

    case 'source.inspected': {
      if (!isCurrent(state, action.requestId) || !state.pending) return state;
      return {
        ...state,
        pending: {
          ...state.pending,
          inspection: action.inspection,
          source: {
            ...state.pending.source,
            hash: action.hash,
            byteLength: action.byteLength,
          },
        },
      };
    }

    case 'worker.progress': {
      if (!isCurrent(state, action.requestId)) return state;
      if (state.pending) {
        return {
          ...state,
          pending: { ...state.pending, stage: action.stage, fraction: action.fraction },
        };
      }
      if (state.export.building) {
        return { ...state, export: { ...state.export, stage: action.stage } };
      }
      return state;
    }

    case 'ingest.done': {
      if (!isCurrent(state, action.requestId) || !state.pending) return state;
      return {
        ...state,
        phase: 'profiling',
        pending: { ...state.pending, rawTable: action.rawTable, stage: 'analyze', fraction: null },
      };
    }

    case 'profile.done': {
      if (!isCurrent(state, action.requestId) || !state.pending) return state;
      const pending: PendingSource = {
        ...state.pending,
        proposedColumns: action.columns,
        issues: action.issues,
        stage: null,
        fraction: null,
      };
      // Sample sources ship manifest-approved fixes — never needsReview.
      // Uploads with actionable issues pause for approval; clean uploads go
      // straight to analyzing.
      const actionable = action.issues.some((i) => i.action !== 'none');
      const phase = pending.kind === 'sample' || !actionable ? 'analyzing' : 'needsReview';
      return { ...state, pending, phase };
    }

    case 'review.approve': {
      if (state.phase !== 'needsReview' || !state.pending) return state;
      return { ...state, phase: 'analyzing' };
    }

    case 'analyze.done': {
      if (!isCurrent(state, action.requestId) || !state.pending) return state;
      const source = { ...state.pending.source, hash: action.sourceHash };
      const firstFinding = action.snapshot.findings[0]?.id ?? null;
      return {
        ...state,
        phase: 'ready',
        active: { source, table: action.table, snapshot: action.snapshot },
        pending: null,
        requestId: null,
        selectedFindingId: firstFinding,
        evidenceOpen: false,
        evidenceFindingId: null,
        scenarioInput: '',
        scenarioRequest: null,
        scenarioRequestId: null,
        scenario: null,
        export: { ...state.export, model: null, artifacts: {}, failure: null },
      };
    }

    case 'request.failed': {
      if (!isCurrent(state, action.requestId)) return state;
      const retained = state.active !== null;
      return {
        ...state,
        phase: retained ? 'ready' : 'idle',
        pending: null,
        requestId: null,
        error: action.error,
        notice: retained ? 'upload.previousRetained' : null,
      };
    }

    case 'request.cancelled': {
      if (!isCurrent(state, action.requestId)) return state;
      const retained = state.active !== null;
      return {
        ...state,
        phase: retained ? 'ready' : 'idle',
        pending: null,
        requestId: null,
        error: null,
      };
    }

    case 'finding.select':
      return { ...state, selectedFindingId: action.findingId };

    case 'finding.clear':
      return { ...state, selectedFindingId: null, evidenceOpen: false, evidenceFindingId: null };

    case 'evidence.open':
      return { ...state, evidenceOpen: true, evidenceFindingId: action.findingId, selectedFindingId: action.findingId };

    case 'evidence.close':
      return { ...state, evidenceOpen: false, evidenceFindingId: null };

    case 'scenario.input':
      return { ...state, scenarioInput: action.text };

    case 'scenario.submit':
      if (state.phase !== 'ready' || state.scenarioRequestId !== null) return state;
      return { ...state, scenarioRequest: action.costChange, scenarioRequestId: action.requestId };

    case 'scenario.done': {
      // Commit only when this is still the in-flight request — a newer submit
      // or reset supersedes stale worker responses (belt under the wire guard).
      if (state.scenarioRequestId === null || state.scenarioRequestId !== action.requestId) return state;
      return { ...state, scenario: action.result, scenarioRequest: null, scenarioRequestId: null };
    }

    case 'scenario.failed': {
      if (state.scenarioRequestId !== action.requestId) return state;
      return { ...state, scenarioRequest: null, scenarioRequestId: null, error: action.error };
    }

    case 'scenario.reset':
      return { ...state, scenario: null, scenarioRequest: null, scenarioRequestId: null, scenarioInput: '' };

    case 'export.open':
      if (state.phase !== 'ready' && state.phase !== 'exporting') return state;
      return { ...state, export: { ...state.export, open: true, failure: null } };

    case 'export.close':
      return { ...state, export: { ...state.export, open: false } };

    case 'export.begin':
      if (state.phase !== 'ready') return state;
      return {
        ...state,
        phase: 'exporting',
        export: {
          open: true,
          building: true,
          stage: 'model',
          model: action.model,
          artifacts: {},
          failure: null,
          scenarioId: state.scenario?.id ?? null,
          locale: action.model.locale,
        },
      };

    case 'export.progress':
      if (!state.export.building) return state;
      return { ...state, export: { ...state.export, stage: action.stage } };

    case 'export.done': {
      const artifacts = { ...state.export.artifacts, [action.format]: action.entry };
      return { ...state, export: { ...state.export, artifacts } };
    }

    case 'export.failed':
      return {
        ...state,
        export: {
          ...state.export,
          failure: { format: action.format, code: action.code, messageKey: action.messageKey },
        },
      };

    case 'export.finished':
      return { ...state, phase: 'ready', export: { ...state.export, building: false, stage: null } };

    case 'session.replay':
      if (!state.active) return state;
      return {
        ...state,
        phase: 'ready',
        selectedFindingId: state.active.snapshot.findings[0]?.id ?? null,
        evidenceOpen: false,
        evidenceFindingId: null,
        scenarioInput: '',
        scenarioRequest: null,
        scenarioRequestId: null,
        scenario: null,
        error: null,
        notice: null,
        export: { ...initialSession(state.sessionId).export },
      };

    case 'session.clear':
      return initialSession(action.sessionId);

    default:
      return state;
  }
}
