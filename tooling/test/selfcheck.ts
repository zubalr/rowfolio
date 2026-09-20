/**
 * Harness self-check (tooling/test/selfcheck.ts).
 *
 * Proves the harness detects planted failures rather than succeeding
 * against empty stubs. Runs two layers:
 *   1. corpus check — every fixtures/hostile manifest entry must produce
 *      its declared findings (static, file-backed);
 *   2. planted-mutation battery — fresh in-memory mutations of known-good
 *      payloads (metric value, worker revision, ZIP bytes, locale catalog,
 *      CSV cell) must each be detected.
 *
 * Exit 0 only when every expected detection fires. Deterministic: no
 * timestamps, fixed mutation offsets.
 *
 *   node tooling/test/selfcheck.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasCode } from './findings.ts';
import { inspectBytes } from './inspect.ts';
import { dataOffset, readZip } from './zip.ts';
import { catalogGaps } from './locale.ts';
import { assertMetric, metricEqual, MetricMismatch } from './metrics.ts';
import { classifyResponse, progressSequenceIssues } from './envelope.ts';
import { flipByte, removeJsonField, setJsonField, truncateBytes, writeUint16LE } from './mutate.ts';
import { scanCsv } from './csv.ts';
import { runCorpus } from './run_corpus.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const HOSTILE = join(REPO, 'fixtures', 'hostile');
const NATIVE = join(HOSTILE, 'native');
const GOLDEN = join(REPO, 'fixtures', 'golden');

interface Check {
  name: string;
  detected: boolean;
  detail: string;
}

const loadJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const loadBytes = (p: string): Uint8Array => new Uint8Array(readFileSync(p));

function battery(): Check[] {
  const checks: Check[] = [];
  const oracle = loadJson(join(GOLDEN, 'oracle_report.json')) as Record<string, unknown>;

  // 1. Deliberately wrong metric must fail against the oracle.
  {
    const wrong = String(oracle['northJuneRevenue']).replace(/^8/, '9'); // 881000 -> 981000
    let detected = false;
    try {
      assertMetric(wrong, String(oracle['northJuneRevenue']), 'northJuneRevenue');
    } catch (err) {
      detected = err instanceof MetricMismatch;
    }
    checks.push({
      name: 'planted wrong metric (northJuneRevenue 981000 vs 881000)',
      detected,
      detail: detected ? 'MetricMismatch thrown' : 'mutation accepted — harness blind',
    });
    checks.push({
      name: 'control metric still passes',
      detected: metricEqual(String(oracle['northJuneRevenue']), '881000'),
      detail: 'oracle self-agreement',
    });
  }

  // 2. Stale worker response must classify stale/invalid, never current.
  {
    const ctx = { requestId: 'req-1', sessionId: 'sess-1', revision: 7 };
    const good = { protocolVersion: 1, requestId: 'req-1', sessionId: 'sess-1', revision: 7, kind: 'success', result: { disposed: true } };
    const stale = setJsonField(good, ['revision'], 6);
    const wrongSession = setJsonField(good, ['sessionId'], 'sess-old');
    const oldProtocol = setJsonField(good, ['protocolVersion'], 0);
    checks.push({ name: 'control response classifies current', detected: classifyResponse(good, ctx) === 'current', detail: '' });
    checks.push({ name: 'stale revision detected', detected: classifyResponse(stale, ctx) === 'stale', detail: '' });
    checks.push({ name: 'wrong session detected', detected: classifyResponse(wrongSession, ctx) === 'stale', detail: '' });
    checks.push({ name: 'old protocolVersion detected', detected: classifyResponse(oldProtocol, ctx) === 'invalid', detail: '' });
    const regression = [
      { stage: 'parse', fraction: 0.4 },
      { stage: 'parse', fraction: 0.2 },
    ];
    checks.push({
      name: 'within-stage progress regression detected',
      detected: hasCode(progressSequenceIssues(regression), 'progress.regression'),
      detail: '',
    });
  }

  // 3. Corrupted ZIP bytes must be detected at multiple layers.
  {
    const good = loadBytes(join(NATIVE, 'control-minimal.xlsx'));
    const truncated = inspectBytes(truncateBytes(good, Math.floor(good.length * 0.6)));
    checks.push({
      name: 'truncated xlsx detected',
      detected: !truncated.ok && hasCode(truncated.findings, 'zip.no-eocd'),
      detail: truncated.findings.map((f) => f.code).join(','),
    });
    // flip a byte inside a real entry's stored payload
    const zr = readZip(good);
    const sheet = zr.entries.find((e) => e.name === 'xl/worksheets/sheet1.xml');
    const flipped = inspectBytes(flipByte(good, sheet ? dataOffset(good, sheet) : 40));
    checks.push({
      name: 'payload byte-flip detected (crc-mismatch)',
      detected: !flipped.ok && hasCode(flipped.findings, 'zip.crc-mismatch'),
      detail: flipped.findings.map((f) => f.code).join(','),
    });
    // patch EOCD totalEntries u16 past the policy limit
    const eocd = good.length - 22;
    const lied = inspectBytes(writeUint16LE(Uint8Array.from(good), eocd + 10, 5000));
    checks.push({
      name: 'entry-count lie detected',
      detected: !lied.ok && hasCode(lied.findings, 'zip.entry-count'),
      detail: lied.findings.map((f) => f.code).join(','),
    });
    checks.push({ name: 'control xlsx stays clean', detected: inspectBytes(good).ok, detail: '' });
  }

  // 4. Missing locale key must fail.
  {
    const ref = { 'a.one': 'One {x}', 'a.two': 'Two' };
    const dropped = removeJsonField(ref, ['a.two']);
    const renamed = setJsonField(ref, ['a.one'], 'One {y}');
    checks.push({
      name: 'missing locale key detected',
      detected: catalogGaps(ref, dropped).missingKeys.includes('a.two'),
      detail: '',
    });
    checks.push({
      name: 'placeholder rename detected',
      detected: catalogGaps(ref, renamed).placeholderMismatches.length === 1,
      detail: '',
    });
    checks.push({ name: 'control catalog has no gaps', detected: Object.values(catalogGaps(ref, ref)).every((v) => v.length === 0), detail: '' });
  }

  // 5. Formula-prefix CSV cell flagged; clean CSV quiet on that rule.
  {
    const hostile = scanCsv('a,b\n=cmd|calc,1\n');
    const clean = scanCsv('a,b\n1,2\n');
    checks.push({
      name: 'formula-prefix cell detected',
      detected: hasCode(hostile.findings, 'csv.formula-prefix'),
      detail: '',
    });
    checks.push({
      name: 'clean csv has no formula-prefix findings',
      detected: !hasCode(clean.findings, 'csv.formula-prefix'),
      detail: '',
    });
  }

  return checks;
}

function main(): number {
  const corpus = runCorpus(HOSTILE);
  const checks = battery();
  let failed = 0;
  for (const e of corpus.entries) {
    const ok = e.verdict === 'pass';
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} corpus ${e.path} (${e.inspector}) expected=[${e.expected.join(',')}] actual=[${e.actual.join(',')}]`);
  }
  for (const c of checks) {
    if (!c.detected) failed += 1;
    console.log(`${c.detected ? 'ok  ' : 'FAIL'} mutation ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  console.log(`selfcheck: ${corpus.entries.length + checks.length - failed} detected / ${failed} missed`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}

export { battery };
