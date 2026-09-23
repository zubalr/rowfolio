/**
 * Importable contract examples — the package ships typed example objects that
 * downstream packages (and these tests) can consume without fixture IO.
 */
import { describe, expect, it } from 'vitest';
import {
  checkContract,
  FINDING_EXAMPLE,
  OPERATING_COST_SCENARIO_V1,
  PROVENANCE_EXAMPLE,
  SCENARIO_DEFINITION_EXAMPLE,
  WORKER_REQUEST_EXAMPLE,
} from '../../packages/contracts/src/index.ts';

describe('importable contract examples', () => {
  it('finding example validates', () => {
    expect(checkContract('Finding', FINDING_EXAMPLE)).toEqual([]);
  });
  it('provenance example validates', () => {
    expect(checkContract('Provenance', PROVENANCE_EXAMPLE)).toEqual([]);
  });
  it('scenario definition examples validate', () => {
    expect(checkContract('ScenarioDefinition', SCENARIO_DEFINITION_EXAMPLE)).toEqual([]);
    expect(checkContract('ScenarioDefinition', OPERATING_COST_SCENARIO_V1)).toEqual([]);
  });
  it('worker request example validates', () => {
    expect(checkContract('WorkerRequest', WORKER_REQUEST_EXAMPLE)).toEqual([]);
  });
});
