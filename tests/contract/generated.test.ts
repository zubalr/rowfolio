/**
 * Generated-type drift guard: `src/types.ts` must be byte-identical to what
 * `node scripts/generate-types.mjs` regenerates from the schema. If this
 * fails, run `pnpm --filter @rowfolio/contracts generate:types`.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CONTRACTS_PKG } from './helpers.ts';

describe('generated structural types', () => {
  it('src/types.ts has no diff from the schema', () => {
    const out = execFileSync(process.execPath, [join('scripts', 'generate-types.mjs'), '--check'], {
      cwd: CONTRACTS_PKG,
      encoding: 'utf8',
    });
    expect(out).toContain('matches the schema');
  });
});
