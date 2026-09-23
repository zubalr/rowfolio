import type { WorkerFactory, WorkerLike } from './transport.ts';

/** Options passed to the analysis worker via the Worker `name` channel. */
export interface IngestParseOptions {
  selectedSheetId?: string;
  headerRow?: number;
  firstColumn?: number;
  lastColumn?: number;
  allowHiddenSheet?: boolean;
  delimiter?: ',' | '\t' | ';';
}

/** Real Worker factory — used in the browser bundle. */
export function createAnalysisWorkerFactory(parseOptions?: IngestParseOptions | null): WorkerFactory {
  return () =>
    new Worker(new URL('./analysis.worker.ts', import.meta.url), {
      type: 'module',
      name: parseOptions ? JSON.stringify({ parseOptions }) : 'rowfolio-analysis',
    }) as unknown as WorkerLike;
}

export function createExportWorkerFactory(): WorkerFactory {
  return () =>
    new Worker(new URL('./export.worker.ts', import.meta.url), {
      type: 'module',
      name: 'rowfolio-export',
    }) as unknown as WorkerLike;
}
