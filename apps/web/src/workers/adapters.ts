/**
 * Runtime adapter resolution. Engine packages ship as workspace deps; while a
 * package is still a stub (`export {}`) the surface check fails and callers get
 * a typed UNSUPPORTED error — never a mock on a production path.
 *
 * Dynamic import paths are literal strings so Vite keeps each package in its
 * own chunk (landing entry stays free of engines).
 */
export class AdapterUnavailableError extends Error {
  readonly packageName: string;
  constructor(packageName: string, missing: string) {
    super(`adapter ${packageName} missing required export ${missing}`);
    this.name = 'AdapterUnavailableError';
    this.packageName = packageName;
  }
}

type UnknownModule = Record<string, unknown>;

function requireFns(module: UnknownModule, packageName: string, names: readonly string[]): void {
  for (const name of names) {
    if (typeof module[name] !== 'function') {
      throw new AdapterUnavailableError(packageName, name);
    }
  }
}

// Loose structural signatures — adapters are verified at runtime and invoked
// with contract-typed arguments; `never[]` keeps these from over-constraining.
export interface IngestAdapter {
  parseSource: (...args: unknown[]) => unknown;
  inspectSource: (...args: unknown[]) => unknown;
  handleIngestRequest: (...args: unknown[]) => unknown;
}

export async function loadIngest(): Promise<IngestAdapter> {
  const mod = (await import('@rowfolio/ingest')) as UnknownModule;
  requireFns(mod, '@rowfolio/ingest', ['parseSource', 'inspectSource', 'handleIngestRequest']);
  return mod as unknown as IngestAdapter;
}

export interface NormalizeAdapter {
  profileTable: (...args: unknown[]) => unknown;
  normalizeTable: (...args: unknown[]) => unknown;
}

export async function loadNormalize(): Promise<NormalizeAdapter> {
  const mod = (await import('@rowfolio/normalize')) as UnknownModule;
  requireFns(mod, '@rowfolio/normalize', ['profileTable', 'normalizeTable']);
  return mod as unknown as NormalizeAdapter;
}

export interface AnalysisAdapter {
  analyze: (...args: unknown[]) => unknown;
}

export async function loadAnalysis(): Promise<AnalysisAdapter> {
  const mod = (await import('@rowfolio/analysis')) as UnknownModule;
  requireFns(mod, '@rowfolio/analysis', ['analyze']);
  return mod as unknown as AnalysisAdapter;
}

export interface ScenarioAdapter {
  runScenario: (...args: unknown[]) => unknown;
}

export async function loadScenario(): Promise<ScenarioAdapter> {
  const mod = (await import('@rowfolio/scenario')) as UnknownModule;
  requireFns(mod, '@rowfolio/scenario', ['runScenario']);
  return mod as unknown as ScenarioAdapter;
}

export interface ProvenanceAdapter {
  evaluateProof: (...args: unknown[]) => unknown;
  readEvidencePage: (...args: unknown[]) => unknown;
}

export async function loadProvenance(): Promise<ProvenanceAdapter> {
  const mod = (await import('@rowfolio/provenance')) as UnknownModule;
  requireFns(mod, '@rowfolio/provenance', ['evaluateProof', 'readEvidencePage']);
  return mod as unknown as ProvenanceAdapter;
}

export interface ExportModelAdapter {
  buildExportModel: (...args: unknown[]) => unknown;
}

export async function loadExportModel(): Promise<ExportModelAdapter> {
  const mod = (await import('@rowfolio/export-model')) as UnknownModule;
  requireFns(mod, '@rowfolio/export-model', ['buildExportModel']);
  return mod as unknown as ExportModelAdapter;
}

export interface ExportWriters {
  /** `buildWorkbook(model, progress) → Promise<BuiltArtifact>` per INTERFACES.md. */
  buildWorkbook: (...args: unknown[]) => unknown;
  /** `buildPresentation(model, progress) → Promise<BuiltArtifact>` per INTERFACES.md. */
  buildPresentation: (...args: unknown[]) => unknown;
}

export async function loadExportWriters(format: 'xlsx' | 'pptx'): Promise<ExportWriters[keyof ExportWriters]> {
  if (format === 'xlsx') {
    const mod = (await import('@rowfolio/export-xlsx')) as UnknownModule;
    requireFns(mod, '@rowfolio/export-xlsx', ['buildWorkbook']);
    return mod['buildWorkbook'] as ExportWriters['buildWorkbook'];
  }
  const mod = (await import('@rowfolio/export-pptx')) as UnknownModule;
  requireFns(mod, '@rowfolio/export-pptx', ['buildPresentation']);
  return mod['buildPresentation'] as ExportWriters['buildPresentation'];
}
