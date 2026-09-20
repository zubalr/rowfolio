/**
 * Self-tests for the independent native-file inspectors. Every manifest
 * fixture must produce its declared findings; planted binary mutations of
 * the clean control must be caught; the Python stdlib inspector must
 * agree with the JS one (independent implementations, not shared code).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flipByte, truncateBytes, writeUint32LE } from '../../tooling/test/mutate.ts';
import { cdEntryOffset, dataOffset, readZip } from '../../tooling/test/zip.ts';
import { scanXml } from '../../tooling/test/ooxml.ts';
import {
  assertFindings,
  hasCode,
  inspectBytes,
  inspectHostileFixture,
  loadHostileManifest,
  FIXTURES_HOSTILE,
  FIXTURES_SAMPLE,
  TOOLING_TEST,
  hostileFixture,
  loadBytes,
} from './index.ts';

const manifest = loadHostileManifest();
const nativeFixtures = manifest.fixtures.filter((f) => f.inspector === 'native');

describe('hostile fixture corpus (JS inspectors)', () => {
  it('manifest declares fixtures for every planted class', () => {
    const inspectors = new Set(manifest.fixtures.map((f) => f.inspector));
    for (const i of ['native', 'csv', 'worker-response', 'envelope', 'progress', 'locale', 'metric']) {
      expect(inspectors.has(i as never), `manifest has ${i} fixtures`).toBe(true);
    }
  });

  for (const f of nativeFixtures) {
    it(`${f.path} → ${f.expect.join(',') || 'clean'}`, () => {
      const report = inspectHostileFixture(f.path);
      assertFindings(f.path, report.findings, f.expect);
    });
  }

  it('every fixture file stays inside the documented envelope', () => {
    for (const f of manifest.fixtures) {
      const size = statSync(join(FIXTURES_HOSTILE, f.path)).size;
      expect(size, `${f.path} exceeds maxFileBytes`).toBeLessThanOrEqual(manifest.envelope.maxFileBytes);
    }
  });
});

describe('planted binary mutations', () => {
  const control = loadBytes(hostileFixture('native/control-minimal.xlsx'));

  it('truncation is detected (zip.no-eocd)', () => {
    const findings = inspectBytes(truncateBytes(control, control.length - 60)).findings;
    expect(hasCode(findings, 'zip.no-eocd')).toBe(true);
  });

  it('payload byte-flip is detected (zip.crc-mismatch)', () => {
    const zr = readZip(control);
    const sheet = zr.entries.find((e) => e.name === 'xl/worksheets/sheet1.xml');
    expect(sheet).toBeDefined();
    const mutated = flipByte(control, dataOffset(control, sheet!));
    expect(hasCode(inspectBytes(mutated).findings, 'zip.crc-mismatch')).toBe(true);
  });

  it('declared-oversize entry is detected (zip.entry-declared-oversize)', () => {
    const zr = readZip(control);
    const sheet = zr.entries.find((e) => e.name === 'xl/worksheets/sheet1.xml')!;
    // patch the central-directory uncompressed size field (+24 in CD header)
    const cdOff = cdEntryOffset(control, zr, sheet.name);
    expect(cdOff).toBeGreaterThan(0);
    const mutated = writeUint32LE(control, cdOff + 24, 200 * 1024 * 1024);
    const findings = inspectBytes(mutated).findings;
    expect(hasCode(findings, 'zip.entry-declared-oversize')).toBe(true);
  });

  it('control xlsx stays clean', () => {
    expect(inspectBytes(control).findings.filter((x) => x.severity === 'error')).toEqual([]);
  });
});

describe('cross-inspector agreement (Python stdlib vs JS)', () => {
  const py = join(TOOLING_TEST, 'inspect_native.py');
  const pythonAvailable = (() => {
    try {
      execFileSync('python3', ['--version']);
      return true;
    } catch {
      return false;
    }
  })();

  for (const rel of ['native/control-minimal.xlsx', 'native/corrupt-bad-crc.xlsx', 'native/encrypted-ooxml.xlsx', 'native/external-workbook-link.xlsx']) {
    it(`python inspector agrees on ${rel}`, () => {
      if (!pythonAvailable) return; // environment without python: JS side already proved
      const js = inspectHostileFixture(rel).findings.map((f) => f.code).sort();
      const out = execFileSync('python3', [py, join(FIXTURES_HOSTILE, rel), '--json'], { encoding: 'utf8' });
      const pyReport = JSON.parse(out) as { findings: { code: string }[] };
      const pyCodes = [...new Set(pyReport.findings.map((f) => f.code))].sort();
      expect(new Set(pyCodes)).toEqual(new Set(js));
    });
  }
});

describe('deflated archives (method 8 coverage)', () => {
  it('real deflated sample xlsx inspects clean', () => {
    const sample = join(FIXTURES_SAMPLE, 'sample_operations.xlsx');
    if (!existsSync(sample)) return; // sample fixture may be absent on partial checkouts
    const report = inspectBytes(loadBytes(sample), 'sample_operations.xlsx');
    const zr = readZip(loadBytes(sample));
    expect(zr.entries.some((e) => e.method === 8), 'fixture exercises inflate path').toBe(true);
    expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });
});

describe('scanXml robustness', () => {
  it('tolerates declarations, comments and entity refs', () => {
    const tags = scanXml('<?xml version="1.0"?><r><!-- c --><a href="x&amp;y">t</a></r>');
    expect(tags.filter((t) => !t.closing).map((t) => t.name)).toEqual(['r', 'a']);
  });
  it('rejects unterminated markup', () => {
    expect(() => scanXml('<a href="unterminated')).toThrow();
  });
});

describe('fixture disk hygiene', () => {
  it('no stray files outside manifest coverage in fixtures/hostile', () => {
    const covered = new Set([...manifest.fixtures.map((f) => f.path), ...manifest.meta]);
    // generated/ is covered by its own corpus index (caseId -> artifact + manifest).
    const corpusIndexPath = join(FIXTURES_HOSTILE, 'generated', 'corpus-index.json');
    if (existsSync(corpusIndexPath)) {
      const index = JSON.parse(readFileSync(corpusIndexPath, 'utf8')) as {
        cases: { artifact: string }[];
      };
      for (const c of index.cases) {
        covered.add(`generated/${c.artifact}`);
        covered.add(`generated/${c.artifact.replace(/\.[^.]+$/, '')}.manifest.json`);
      }
    }
    const walk = (dir: string, prefix: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(join(dir, d.name), `${prefix}${d.name}/`) : [`${prefix}${d.name}`],
      );
    for (const rel of walk(FIXTURES_HOSTILE, '')) {
      expect(covered.has(rel), `${rel} not listed in manifest.json (fixtures or meta)`).toBe(true);
    }
  });
});
