/**
 * Fixture corpus runner (tooling/test/run_corpus.ts).
 *
 * Reads fixtures/hostile/manifest.json, runs the declared inspector against
 * every fixture, and verifies each produces exactly the expected signal:
 * every `expect` finding code must appear, and no error-severity finding
 * outside `expect` may appear (control fixtures declare expect: []).
 *
 * Usage:
 *   node tooling/test/run_corpus.ts            # verify corpus, print report
 *   node tooling/test/run_corpus.ts --write    # also write corpus-report.json
 *
 * The report is deterministic (sorted paths, sha256 of file bytes, no
 * timestamps) so the committed copy doubles as the verification report.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyResponse, progressSequenceIssues, envelopeIssues, type GuardContext } from './envelope.ts';
import { hasCode, type Finding } from './findings.ts';
import { inspectFile } from './inspect.ts';
import { catalogGaps, gapFindings, type Catalog } from './locale.ts';
import { compareOracleFields } from './metrics.ts';
import { scanCsv } from './csv.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HOSTILE_DIR = join(REPO_ROOT, 'fixtures', 'hostile');
export const REPORT_PATH = join(REPO_ROOT, 'tooling', 'test', 'corpus-report.json');

export interface CorpusEntry {
  path: string;
  inspector: 'native' | 'worker-response' | 'envelope' | 'progress' | 'locale' | 'metric' | 'csv';
  description: string;
  expect: string[];
  context?: GuardContext;
  reference?: string;
  fields?: string[];
  oracle?: string;
}

export interface CorpusManifest {
  schemaVersion: string;
  envelope: { maxFileBytes: number; maxExpandedBytes: number; maxEntries: number };
  meta: string[];
  fixtures: CorpusEntry[];
}

export interface EntryResult {
  path: string;
  sha256: string | null;
  bytes: number | null;
  inspector: string;
  expected: string[];
  actual: string[];
  missing: string[];
  unexpected: string[];
  verdict: 'pass' | 'fail' | 'missing-file';
}

export interface CorpusReport {
  corpusVersion: string;
  generatedBy: string;
  contractVersion: string;
  entries: EntryResult[];
  failed: number;
  passed: number;
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

export function loadManifest(dir: string = HOSTILE_DIR): CorpusManifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as CorpusManifest;
}

function findingsFor(entry: CorpusEntry, abs: string, manifestDir: string): Finding[] {
  switch (entry.inspector) {
    case 'native':
      return inspectFile(abs).findings;
    case 'csv':
      return scanCsv(readFileSync(abs, 'utf8')).findings;
    case 'worker-response': {
      const msg = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
      const freshness = classifyResponse(msg, entry.context ?? { requestId: '', sessionId: '', revision: 0 });
      return [
        freshness === 'current'
          ? { code: 'envelope.current', severity: 'warning' as const, detail: 'response classifies current (control)' }
          : { code: `envelope.${freshness}`, severity: 'error' as const, detail: `response classifies ${freshness}` },
      ];
    }
    case 'envelope': {
      const env = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
      return envelopeIssues(env);
    }
    case 'progress': {
      const events = JSON.parse(readFileSync(abs, 'utf8')) as { stage: string; fraction: number | null }[];
      return progressSequenceIssues(events);
    }
    case 'locale': {
      const reference = JSON.parse(readFileSync(join(manifestDir, entry.reference ?? ''), 'utf8')) as Catalog;
      const candidate = JSON.parse(readFileSync(abs, 'utf8')) as Catalog;
      return gapFindings(catalogGaps(reference, candidate), entry.path);
    }
    case 'metric': {
      const oracle = JSON.parse(readFileSync(join(REPO_ROOT, entry.oracle ?? ''), 'utf8')) as Record<string, unknown>;
      const claims = JSON.parse(readFileSync(abs, 'utf8')) as { metrics: Record<string, unknown> };
      return compareOracleFields(claims.metrics, oracle, entry.fields ?? Object.keys(claims.metrics), entry.path);
    }
  }
}

export function runCorpus(manifestDir: string = HOSTILE_DIR): CorpusReport {
  const manifest = loadManifest(manifestDir);
  const entries: EntryResult[] = [];
  for (const e of manifest.fixtures) {
    const abs = join(manifestDir, e.path);
    if (!existsSync(abs)) {
      entries.push({
        path: e.path,
        sha256: null,
        bytes: null,
        inspector: e.inspector,
        expected: e.expect,
        actual: [],
        missing: e.expect,
        unexpected: [],
        verdict: 'missing-file',
      });
      continue;
    }
    const bytes = new Uint8Array(readFileSync(abs));
    const findings = findingsFor(e, abs, manifestDir);
    const actual = findings.map((f) => f.code);
    const missing = e.expect.filter((c) => !hasCode(findings, c));
    const unexpected = findings
      .filter((f) => f.severity === 'error' && !e.expect.includes(f.code))
      .map((f) => f.code);
    const verdict = missing.length === 0 && unexpected.length === 0 ? 'pass' : 'fail';
    entries.push({
      path: e.path,
      sha256: sha256(bytes),
      bytes: bytes.length,
      inspector: e.inspector,
      expected: e.expect,
      actual,
      missing,
      unexpected,
      verdict,
    });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    corpusVersion: '1.0.0',
    generatedBy: 'tooling/test/run_corpus.ts',
    contractVersion: '1.0.0',
    entries,
    failed: entries.filter((e) => e.verdict !== 'pass').length,
    passed: entries.filter((e) => e.verdict === 'pass').length,
  };
}

function main(argv: string[]): number {
  const write = argv.includes('--write');
  const report = runCorpus();
  const json = JSON.stringify(report, null, 2) + '\n';
  if (write) {
    writeFileSync(REPORT_PATH, json);
    console.error(`wrote ${REPORT_PATH}`);
  } else {
    process.stdout.write(json);
  }
  for (const e of report.entries.filter((x) => x.verdict !== 'pass')) {
    console.error(`FAIL ${e.path}: missing=[${e.missing.join(',')}] unexpected=[${e.unexpected.join(',')}]`);
  }
  console.error(`corpus: ${report.passed} pass / ${report.failed} fail`);
  return report.failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  process.exit(main(process.argv.slice(2)));
}
