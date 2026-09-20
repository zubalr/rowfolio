/**
 * The committed corpus report must equal a fresh corpus run — byte-for-
 * byte deterministic evidence, not a stale snapshot. Also re-runs every
 * manifest entry's verdict so `pnpm test` alone covers the whole corpus.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPORT_PATH, runCorpus } from '../../tooling/test/run_corpus.ts';

describe('fixture corpus runner', () => {
  const report = runCorpus();

  it('every fixture entry passes its declared expectations', () => {
    const failures = report.entries.filter((r) => r.verdict !== 'pass');
    expect(failures.map((f) => `${f.path}: missing=${f.missing} unexpected=${f.unexpected}`)).toEqual([]);
    expect(report.failed).toBe(0);
  });

  it('committed corpus-report.json is identical to a fresh run (deterministic evidence)', () => {
    expect(existsSync(REPORT_PATH), 'run `node tooling/test/run_corpus.ts --write` first').toBe(true);
    const committed = readFileSync(REPORT_PATH, 'utf8');
    expect(committed).toBe(JSON.stringify(report, null, 2) + '\n');
  });
});
