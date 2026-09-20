/**
 * Public entry surface for `@rowfolio/scenario`.
 *
 * Only the contract-assigned `runScenario` signature crosses the package
 * boundary. Money quantization and id helpers are exported for
 * testability; baseline immutability is guaranteed by construction (the
 * snapshot is only read).
 */
import type { RunScenario } from '@rowfolio/contracts/interfaces';
import { runScenario as runScenarioImpl } from './scenario.ts';

export type { RunScenario };
export { runScenario, quantizeMoney, fractionScale, scenarioId } from './scenario.ts';
export { ScenarioError } from './scenario.ts';

export const runScenarioApi: RunScenario = runScenarioImpl;
