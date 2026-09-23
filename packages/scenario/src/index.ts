/**
 * Public entry surface for `@rowfolio/scenario`.
 *
 * `runScenario` reads (never mutates) the baseline snapshot. Money
 * quantization and id helpers are exported for testability.
 */
export { runScenario, quantizeMoney, fractionScale, scenarioId } from './scenario.ts';
export { ScenarioError } from './scenario.ts';
