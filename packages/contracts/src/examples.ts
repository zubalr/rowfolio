/**
 * Importable contract examples (v1.0.0). These are canonical positive
 * fixtures — the contract test suite asserts every one validates and the
 * negative fixtures in tests/contract/fixtures/negative fail for the
 * intended reason.
 */
import type { Finding, Provenance, ScenarioDefinition, WorkerRequest } from './types.ts';

import findingExample from '../source/examples/finding.example.json';
import provenanceExample from '../source/examples/provenance.example.json';
import scenarioDefinitionExample from '../source/examples/scenario-definition.example.json';
import workerRequestExample from '../source/examples/worker-request.example.json';

export const FINDING_EXAMPLE: Finding = findingExample as Finding;
export const PROVENANCE_EXAMPLE: Provenance = provenanceExample as Provenance;
export const SCENARIO_DEFINITION_EXAMPLE: ScenarioDefinition = scenarioDefinitionExample as ScenarioDefinition;
export const WORKER_REQUEST_EXAMPLE: WorkerRequest = workerRequestExample as WorkerRequest;

/** The single v1 scenario definition, fixed by the schema (`id`/`version` are const). */
export const OPERATING_COST_SCENARIO_V1: ScenarioDefinition = SCENARIO_DEFINITION_EXAMPLE;
