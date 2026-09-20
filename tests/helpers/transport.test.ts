/**
 * Worker-transport self-tests with dual-oracle assertions: the contract
 * classifiers (packages/contracts) and the independent checkers
 * (tooling/test) must agree on every case — current/stale/invalid.
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../packages/contracts/src/index.ts';
import { progressSequenceIssues } from '../../tooling/test/envelope.ts';
import {
  buildError,
  buildProgress,
  buildSuccess,
  createProgressChecker,
  expectEnvelopeAgree,
  expectFreshnessAgree,
  expectResponseShapeValid,
  guard,
  hostileFixture,
  loadJson,
  makeEnvelope,
  DEFAULT_GUARD,
} from './index.ts';

const workerFixture = (name: string): unknown => loadJson(hostileFixture(`worker/${name}`));

const CORPUS_GUARD = guard({ requestId: 'req-current', sessionId: 'sess-a', revision: 3 });

describe('response freshness (dual oracle)', () => {
  it('accepts a well-formed current response', () => {
    expectResponseShapeValid('control', workerFixture('response-current.json'));
    expectFreshnessAgree('control', workerFixture('response-current.json'), CORPUS_GUARD, 'current');
  });

  it('flags stale revision as stale on both oracles', () => {
    // fixture revision 2 while the expected context wants 3
    expectFreshnessAgree('stale-revision', workerFixture('response-stale-revision.json'), CORPUS_GUARD, 'stale');
  });

  it('flags wrong sessionId as stale on both oracles', () => {
    expectFreshnessAgree('stale-session', workerFixture('response-stale-session.json'), CORPUS_GUARD, 'stale');
  });

  it('flags protocolVersion mismatch as invalid on both oracles', () => {
    expectFreshnessAgree('old-protocol', workerFixture('response-invalid-protocol.json'), CORPUS_GUARD, 'invalid');
  });

  it('flags malformed shape as invalid on both oracles', () => {
    expectFreshnessAgree('bad-shape', workerFixture('response-invalid-shape.json'), CORPUS_GUARD, 'invalid');
  });

  it('a response for a different request is stale', () => {
    expectFreshnessAgree('other-request', buildSuccess({ requestId: 'req-other' }), DEFAULT_GUARD, 'stale');
  });

  it('built responses are schema-valid', () => {
    for (const [label, r] of [
      ['progress', buildProgress()],
      ['success', buildSuccess()],
      ['error', buildError()],
    ] as const) {
      expectResponseShapeValid(label, r);
    }
  });
});

describe('binary envelopes (dual oracle)', () => {
  // schema-valid success carrying an ExportArtifact so slot checks apply
  const msg = (byteLength: number): Record<string, unknown> => ({
    kind: 'success',
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-test',
    sessionId: 'sess-test',
    revision: 0,
    result: {
      exportId: 'exp-1',
      format: 'xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'brief.xlsx',
      byteLength,
      sha256: 'a'.repeat(64),
      binarySlot: 'result.bin',
    },
  });

  it('accepts a complete envelope', () => {
    expectEnvelopeAgree('ok', makeEnvelope(msg(4), { 'result.bin': new Uint8Array(4) }));
  });

  it('flags a missing declared slot on both oracles', () => {
    expectEnvelopeAgree('missing', makeEnvelope(msg(4), {}), ['envelope.slot.missing']);
  });

  it('flags a byteLength mismatch on both oracles', () => {
    expectEnvelopeAgree('size', makeEnvelope(msg(4), { 'result.bin': new Uint8Array(512) }), ['envelope.slot.byteLength']);
  });

  it('flags a duplicate slot on both oracles', () => {
    const env = makeEnvelope(msg(4), { 'result.bin': new Uint8Array(4) });
    env.binaries.push(env.binaries[0]!);
    expectEnvelopeAgree('dup', env, ['envelope.slot.unique']);
  });
});

describe('progress monotonicity (dual oracle)', () => {
  it('accepts monotonic within-stage progress', () => {
    const checker = createProgressChecker();
    const events = workerFixture('progress-ok.json') as { stage: string; fraction: number | null }[];
    for (const e of events) expect(checker(e.stage, e.fraction)).toBeNull();
    expect(progressSequenceIssues(events)).toEqual([]);
  });

  it('flags within-stage regression on both oracles', () => {
    const checker = createProgressChecker();
    const events = workerFixture('progress-regression.json') as { stage: string; fraction: number | null }[];
    const contractIssues = events.map((e) => checker(e.stage, e.fraction)).filter(Boolean);
    expect(contractIssues.length).toBeGreaterThan(0);
    const independent = progressSequenceIssues(events);
    expect(independent.some((f) => f.code === 'progress.regression')).toBe(true);
  });
});

describe('JSON-safety of wire values', () => {
  it('responses carry no functions/undefined/binary slots', () => {
    for (const r of [buildProgress(), buildSuccess(), buildError()]) {
      const s = JSON.stringify(r);
      expect(JSON.parse(s)).toEqual(r);
      expect(s).not.toMatch(/ArrayBuffer|undefined|function/);
    }
  });
});
