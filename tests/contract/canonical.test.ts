/**
 * Canonical JSON + source hashing. The fixture binary's sha256 is bound into
 * every sourceRef/sourceHash — this is the provenance anchor of the suite.
 */
import { describe, expect, it } from 'vitest';
import { canonicalize, isHash, sha256Hex } from '../../packages/contracts/src/index.ts';
import type { AnalysisSnapshot, ExportModel, NormalizedTable } from '../../packages/contracts/src/index.ts';
import { fixture, fixtureBytes } from './helpers.ts';

const EXPECTED_SOURCE_HASH = 'f0d6d06e934b1eef01d839d071ec7dcdc6d9d47b58ccf556c4eb44f92adb3f5e';

describe('canonicalize', () => {
  it('sorts keys recursively and emits no whitespace', () => {
    expect(canonicalize({ b: 1, a: { d: [3, { f: 0, e: 1 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"e":1,"f":0}]},"b":1}');
  });
  it('rejects non-JSON values', () => {
    expect(() => canonicalize({ f: () => 1 })).toThrow();
    expect(() => canonicalize({ n: Number.NaN })).toThrow();
    expect(() => canonicalize({ u: undefined })).toThrow();
    expect(() => canonicalize([undefined])).toThrow();
  });
});

describe('sha256Hex', () => {
  it('fixture workbook hashes to the bound source hash', async () => {
    const hex = await sha256Hex(fixtureBytes('sample_operations.xlsx'));
    expect(hex).toBe(EXPECTED_SOURCE_HASH);
  });
  it('isHash accepts only 64 lowercase hex chars', () => {
    expect(isHash(EXPECTED_SOURCE_HASH)).toBe(true);
    expect(isHash('a'.repeat(63))).toBe(false);
    expect(isHash('A'.repeat(64))).toBe(false);
    expect(isHash(42)).toBe(false);
  });
});

describe('fixture source-hash binding', () => {
  it('table, snapshot and export models all carry the workbook hash', () => {
    const table = fixture<NormalizedTable>('normalized-table.example.json');
    const snapshot = fixture<AnalysisSnapshot>('analysis-snapshot.example.json');
    const exportEn = fixture<ExportModel>('export-model.en.example.json');
    const exportAr = fixture<ExportModel>('export-model.ar.example.json');
    expect(table.sourceRef.sourceHash).toBe(EXPECTED_SOURCE_HASH);
    expect(snapshot.sourceHash).toBe(EXPECTED_SOURCE_HASH);
    expect(exportEn.sourceHash).toBe(EXPECTED_SOURCE_HASH);
    expect(exportAr.sourceHash).toBe(EXPECTED_SOURCE_HASH);
    for (const p of snapshot.provenance) {
      for (const r of p.sourceRefs) expect(r.sourceHash).toBe(EXPECTED_SOURCE_HASH);
    }
  });
});
