import { describe, expect, it } from 'vitest';
import type { AnalysisSnapshot, NormalizedTable } from '@rowfolio/contracts';
import { sessionReducer } from './reducer.ts';
import { initialSession, type SessionState } from './state.ts';

import snapshotFixture from '../../../../tests/contract/fixtures/analysis-snapshot.example.json';
import tableFixture from '../../../../tests/contract/fixtures/normalized-table.example.json';

const SNAPSHOT = snapshotFixture as unknown as AnalysisSnapshot;
const TABLE = tableFixture as unknown as NormalizedTable;

function ready(): SessionState {
  let s = initialSession('s1');
  s = sessionReducer(s, {
    type: 'source.begin',
    kind: 'sample',
    source: { name: 'sample_operations.xlsx', format: 'xlsx', byteLength: 1, hash: null },
  });
  s = sessionReducer(s, { type: 'request.start', requestId: 'r1' });
  s = sessionReducer(s, { type: 'ingest.done', requestId: 'r1', rawTable: { id: 'raw-1' } as never });
  s = sessionReducer(s, { type: 'profile.done', requestId: 'r1', columns: [], issues: [] });
  s = sessionReducer(s, {
    type: 'analyze.done',
    requestId: 'r1',
    sourceHash: SNAPSHOT.sourceHash,
    table: TABLE,
    snapshot: SNAPSHOT,
  });
  return s;
}

describe('sessionReducer', () => {
  it('walks idle → reading → profiling → analyzing → ready on the sample path', () => {
    let s = initialSession('s1');
    expect(s.phase).toBe('idle');
    s = sessionReducer(s, {
      type: 'source.begin', kind: 'sample',
      source: { name: 'x.xlsx', format: 'xlsx', byteLength: 0, hash: null },
    });
    expect(s.phase).toBe('reading');
    expect(s.revision).toBe(1);
    s = sessionReducer(s, { type: 'request.start', requestId: 'r' });
    s = sessionReducer(s, { type: 'ingest.done', requestId: 'r', rawTable: { id: 'raw' } as never });
    expect(s.phase).toBe('profiling');
    s = sessionReducer(s, { type: 'profile.done', requestId: 'r', columns: [], issues: [] });
    // no actionable issues → straight to analyzing
    expect(s.phase).toBe('analyzing');
    s = sessionReducer(s, {
      type: 'analyze.done', requestId: 'r',
      sourceHash: SNAPSHOT.sourceHash, table: TABLE, snapshot: SNAPSHOT,
    });
    expect(s.phase).toBe('ready');
    expect(s.active?.snapshot.id).toBe(SNAPSHOT.id);
    expect(s.selectedFindingId).toBe(SNAPSHOT.findings[0]?.id);
  });

  it('pauses at needsReview when actionable issues exist (uploads)', () => {
    let s = initialSession('s1');
    s = sessionReducer(s, {
      type: 'source.begin', kind: 'upload',
      source: { name: 'u.csv', format: 'csv', byteLength: 3, hash: null },
    });
    s = sessionReducer(s, { type: 'request.start', requestId: 'r' });
    s = sessionReducer(s, { type: 'ingest.done', requestId: 'r', rawTable: { id: 'raw' } as never });
    s = sessionReducer(s, {
      type: 'profile.done', requestId: 'r', columns: [],
      issues: [{ id: 'q1', action: 'exclude-row' } as never],
    });
    expect(s.phase).toBe('needsReview');
    s = sessionReducer(s, { type: 'review.approve', requestId: 'r2' });
    expect(s.phase).toBe('analyzing');
  });

  it('drops stale async completions when a newer request owns the guard', () => {
    let s = initialSession('s1');
    s = sessionReducer(s, {
      type: 'source.begin', kind: 'upload',
      source: { name: 'a.csv', format: 'csv', byteLength: 1, hash: null },
    });
    s = sessionReducer(s, { type: 'request.start', requestId: 'old' });
    // a second source supersedes the first mid-flight
    s = sessionReducer(s, {
      type: 'source.begin', kind: 'upload',
      source: { name: 'b.csv', format: 'csv', byteLength: 1, hash: null },
    });
    s = sessionReducer(s, { type: 'request.start', requestId: 'new' });
    // stale completion from the old request must be discarded
    const after = sessionReducer(s, { type: 'ingest.done', requestId: 'old', rawTable: { id: 'raw-stale' } as never });
    expect(after.phase).toBe('reading');
    expect(after.pending?.rawTable).toBeNull();
  });

  it('retains the prior valid session when a new upload fails', () => {
    let s = ready();
    const committed = s.active;
    s = sessionReducer(s, {
      type: 'source.begin', kind: 'upload',
      source: { name: 'bad.csv', format: 'csv', byteLength: 3, hash: null },
    });
    expect(s.phase).toBe('reading');
    s = sessionReducer(s, { type: 'request.start', requestId: 'r9' });
    s = sessionReducer(s, {
      type: 'request.failed', requestId: 'r9',
      error: { code: 'INVALID_FILE', messageKey: 'error.INVALID_FILE', recoverable: true },
    });
    expect(s.phase).toBe('ready');
    expect(s.active).toBe(committed);
    expect(s.notice).toBe('upload.previousRetained');
  });

  it('commits a scenario only for the in-flight requestId', () => {
    let s = ready();
    s = sessionReducer(s, { type: 'scenario.submit', requestId: 'sc1', costChange: '0.08' });
    expect(s.scenarioRequestId).toBe('sc1');
    // stale/different requestId is discarded
    s = sessionReducer(s, {
      type: 'scenario.done', requestId: 'scX', costChange: '0.08',
      result: { id: 'scenario-old' } as never,
    });
    expect(s.scenario).toBeNull();
    s = sessionReducer(s, {
      type: 'scenario.done', requestId: 'sc1', costChange: '0.08',
      result: { id: 'scenario-1' } as never,
    });
    expect(s.scenario?.id).toBe('scenario-1');
    expect(s.scenarioRequestId).toBeNull();
  });

  it('blocks a second scenario submit while one is in flight', () => {
    let s = ready();
    s = sessionReducer(s, { type: 'scenario.submit', requestId: 'sc1', costChange: '0.08' });
    s = sessionReducer(s, { type: 'scenario.submit', requestId: 'sc2', costChange: '0.10' });
    expect(s.scenarioRequestId).toBe('sc1');
    expect(s.scenarioRequest).toBe('0.08');
  });

  it('clear-session resets everything and keeps nothing of the dataset', () => {
    let s = ready();
    s = sessionReducer(s, { type: 'export.open' });
    s = sessionReducer(s, { type: 'session.clear', sessionId: 's2' });
    expect(s.phase).toBe('idle');
    expect(s.active).toBeNull();
    expect(s.sessionId).toBe('s2');
    expect(s.revision).toBe(0);
  });

  it('keeps the pending stage marker monotonic and inside the rendered stage list', () => {
    let s = initialSession('s1');
    s = sessionReducer(s, {
      type: 'source.begin', kind: 'upload',
      source: { name: 'u.csv', format: 'csv', byteLength: 3, hash: null },
    });
    expect(s.pending?.stage).toBe('preflight');
    s = sessionReducer(s, { type: 'request.start', requestId: 'r' });
    s = sessionReducer(s, { type: 'worker.progress', requestId: 'r', stage: 'parse', fraction: 0.4 });
    expect(s.pending?.stage).toBe('parse');
    s = sessionReducer(s, { type: 'ingest.done', requestId: 'r', rawTable: { id: 'raw' } as never });
    // Profiling is the quality-preview step — the marker must not claim
    // 'analyze' while the profile op has not even reported yet.
    expect(s.pending?.stage).toBe('normalize');
    // Worker emits its finer-grained 'profile' stage — folded, not rendered raw.
    s = sessionReducer(s, { type: 'worker.progress', requestId: 'r', stage: 'profile', fraction: null });
    expect(s.pending?.stage).toBe('normalize');
    // A late 'parse' fraction or an unknown stage must never rewind/blank it.
    s = sessionReducer(s, { type: 'worker.progress', requestId: 'r', stage: 'parse', fraction: 0.9 });
    expect(s.pending?.stage).toBe('normalize');
    s = sessionReducer(s, { type: 'worker.progress', requestId: 'r', stage: 'not-a-real-stage', fraction: null });
    expect(s.pending?.stage).toBe('normalize');
    s = sessionReducer(s, { type: 'profile.done', requestId: 'r', columns: [], issues: [] });
    expect(s.phase).toBe('analyzing');
    // profile.done must leave a real stage — null would render as 'preflight'.
    expect(s.pending?.stage).toBe('normalize');
    s = sessionReducer(s, { type: 'request.start', requestId: 'r2' });
    s = sessionReducer(s, { type: 'worker.progress', requestId: 'r2', stage: 'analyze', fraction: null });
    expect(s.pending?.stage).toBe('analyze');
    s = sessionReducer(s, {
      type: 'analyze.done', requestId: 'r2',
      sourceHash: SNAPSHOT.sourceHash, table: TABLE, snapshot: SNAPSHOT,
    });
    expect(s.phase).toBe('ready');
  });

  it('replay resets to the committed baseline without losing the dataset', () => {
    let s = ready();
    s = sessionReducer(s, { type: 'scenario.submit', requestId: 'sc1', costChange: '0.08' });
    s = sessionReducer(s, { type: 'scenario.done', requestId: 'sc1', costChange: '0.08', result: { id: 'sc' } as never });
    s = sessionReducer(s, { type: 'session.replay' });
    expect(s.phase).toBe('ready');
    expect(s.active).not.toBeNull();
    expect(s.scenario).toBeNull();
    expect(s.selectedFindingId).toBe(s.active!.snapshot.findings[0]!.id);
  });
});
