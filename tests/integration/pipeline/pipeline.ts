/**
 * Pipeline orchestration for the hardening harness: the real owned path
 * from a `RawTable` through normalize → analysis → scenario →
 * export-model → XLSX/PPTX artifacts. No mocks, no stubs — every stage
 * calls the production package entry point.
 */
import { analyze } from '../../../packages/analysis/src/index.ts';
import type { AnalysisOptions } from '../../../packages/analysis/src/index.ts';
import type { AnalysisSnapshot, ExportModel, NormalizedTable, RawTable, ScenarioDefinition, ScenarioResult } from '../../../packages/contracts/src/index.ts';
import { buildExportModel } from '../../../packages/export-model/src/index.ts';
import { buildPresentation } from '../../../packages/export-pptx/src/index.ts';
import { buildWorkbook } from '../../../packages/export-xlsx/src/index.ts';
import type { BuiltArtifact } from '../../../packages/export-xlsx/src/index.ts';
import { normalizeTable } from '../../../packages/normalize/src/index.ts';
import type { ApprovalPlan } from '../../../packages/normalize/src/index.ts';
import { runScenario } from '../../../packages/scenario/src/index.ts';

export interface PipelineInput {
  readonly raw: RawTable;
  readonly approvals: ApprovalPlan;
  readonly scope: AnalysisOptions['confirmedScope'];
  readonly definition: ScenarioDefinition;
  readonly costChange: string;
  readonly createdAt: string;
}

export interface PipelineResult {
  readonly table: NormalizedTable;
  readonly snapshot: AnalysisSnapshot;
  readonly scenario: ScenarioResult;
  readonly modelEn: ExportModel;
  readonly modelAr: ExportModel;
  readonly xlsx: BuiltArtifact;
  readonly pptx: BuiltArtifact;
}

const noop = (): void => undefined;

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const table = normalizeTable(input.raw, input.approvals);
  const options: AnalysisOptions = {
    version: '1.0.0',
    confirmedScope: { ...input.scope },
    samplePolicyId: null,
  };
  const snapshot = analyze(table, options);
  const scenario = runScenario(snapshot, input.definition, input.costChange);
  const modelEn = buildExportModel(snapshot, table, scenario, 'en', 'latn', input.createdAt);
  const modelAr = buildExportModel(snapshot, table, scenario, 'ar', 'latn', input.createdAt);
  const xlsx = await buildWorkbook(modelEn, noop);
  const pptx = await buildPresentation(modelEn, noop);
  return { table, snapshot, scenario, modelEn, modelAr, xlsx, pptx };
}

export { noop as noopProgress };
