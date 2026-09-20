/**
 * privacy suite — "source data never leaves the browser" is enforced
 * statically here (dynamic checks need a browser — see e2e/privacy owner).
 * Scans every shipped source file for network primitives and non-literal
 * dynamic imports, and asserts the only fetch call sites are the declared
 * static-asset loaders (sample index/workbook).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_DIRS = ['apps/web/src', 'packages', 'apps/web/public'];

/** Network egress primitives that must never appear in app source. */
const EGRESS_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bfetch\s*\(/, label: 'fetch(' },
  { re: /XMLHttpRequest/, label: 'XMLHttpRequest' },
  { re: /sendBeacon/, label: 'sendBeacon' },
  { re: /new\s+WebSocket/, label: 'WebSocket' },
  { re: /new\s+EventSource/, label: 'EventSource' },
  { re: /navigator\.share/, label: 'navigator.share' },
  { re: /<img[^>]+src\s*=\s*['"]https?:/i, label: 'remote <img>' },
  { re: /url\(\s*['"]?https?:/i, label: 'remote css url()' },
  { re: /import\s*\(\s*[^'"`]/, label: 'non-literal dynamic import' },
];

/** The ONLY sanctioned fetch sites: bundled static sample assets. */
const FETCH_ALLOWLIST = new Set([
  'apps/web/src/app/sample.ts',
]);

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      yield* walk(p);
    } else if (/\.(ts|tsx|css|html)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
      yield p;
    }
  }
}

describe('no egress primitives in shipped source', () => {
  it('only the sample-asset loader calls fetch; nothing else reaches the network', () => {
    const hits: { file: string; label: string; line: number }[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        const text = readFileSync(file, 'utf8');
        const lines = text.split('\n');
        for (const [i, line] of lines.entries()) {
          for (const { re, label } of EGRESS_PATTERNS) {
            if (re.test(line)) {
              hits.push({ file: rel, label, line: i + 1 });
            }
          }
        }
      }
    }
    const illegal = hits.filter((h) => !(h.label === 'fetch(' && FETCH_ALLOWLIST.has(h.file)));
    expect(illegal, JSON.stringify(illegal, null, 2)).toEqual([]);
  });

  it('worker entrypoints contain no network primitives at all (source bytes live there)', () => {
    const workerDir = join(ROOT, 'apps/web/src/workers');
    for (const file of walk(workerDir)) {
      const text = readFileSync(file, 'utf8');
      for (const { re, label } of EGRESS_PATTERNS) {
        expect(re.test(text), `${file} contains ${label}`).toBe(false);
      }
    }
  });
});
