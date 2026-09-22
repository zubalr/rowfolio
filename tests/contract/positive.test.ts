/**
 * Positive fixtures — every shipped example must validate cleanly under both
 * the structural schema and the mandatory semantic refinements.
 */
import { describe, expect, it } from 'vitest';
import {
  assertContract,
  checkContract,
  matchesSchema,
  validateContract,
  type AnalysisSnapshot,
  type ExportModel,
  type NormalizedTable,
  type ScenarioResult,
} from '../../packages/contracts/src/index.ts';
import { CONTRACTS_PKG, fixture } from './helpers.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const table = () => fixture<NormalizedTable>('normalized-table.example.json');
const snapshot = () => fixture<AnalysisSnapshot>('analysis-snapshot.example.json');
const scenario = () => fixture<ScenarioResult>('scenario-result.example.json');

describe('positive fixtures — structural schema', () => {
  it.each([
    ['NormalizedTable', 'normalized-table.example.json'],
    ['AnalysisSnapshot', 'analysis-snapshot.example.json'],
    ['ScenarioResult', 'scenario-result.example.json'],
    ['ExportModel', 'export-model.en.example.json'],
    ['ExportModel', 'export-model.ar.example.json'],
    ['ExportModel', 'export-model.en.default.example.json'],
    ['ExportModel', 'export-model.ar.default.example.json'],
    ['SampleManifest', 'sample_manifest.json'],
  ] as const)('%s fixture matches its schema', (type, name) => {
    expect(matchesSchema(type, fixture(name))).toBe(true);
  });
});

describe('positive fixtures — full contract validation', () => {
  it('normalized table validates standalone', () => {
    const result = validateContract('NormalizedTable', table());
    expect(result.ok).toBe(true);
  });

  it('analysis snapshot validates against its table (recomputes every metric)', () => {
    const t = table();
    const result = validateContract('AnalysisSnapshot', snapshot(), { table: t });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('scenario result validates against its baseline snapshot + table', () => {
    const ctx = { table: table(), snapshot: snapshot() };
    expect(checkContract('ScenarioResult', scenario(), ctx)).toEqual([]);
  });

  it('export models (EN + AR) validate standalone — they embed their own table', () => {
    expect(checkContract('ExportModel', fixture<ExportModel>('export-model.en.example.json'))).toEqual([]);
    expect(checkContract('ExportModel', fixture<ExportModel>('export-model.ar.example.json'))).toEqual([]);
    expect(checkContract('ExportModel', fixture<ExportModel>('export-model.en.default.example.json'))).toEqual([]);
    expect(checkContract('ExportModel', fixture<ExportModel>('export-model.ar.default.example.json'))).toEqual([]);
  });

  it('sample manifest reconciles', () => {
    expect(checkContract('SampleManifest', fixture('sample_manifest.json'))).toEqual([]);
  });

  it('worker request envelope message validates', () => {
    const request = JSON.parse(
      readFileSync(join(CONTRACTS_PKG, 'source', 'examples', 'worker-request.example.json'), 'utf8'),
    );
    expect(checkContract('WorkerRequest', request)).toEqual([]);
  });

  it('assertContract returns the typed value on success', () => {
    const t = assertContract<NormalizedTable>('NormalizedTable', table());
    expect(t.id).toBe('operations-v1');
  });
});
