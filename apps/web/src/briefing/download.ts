/**
 * Direct download path for the prepared report: runs the real export writers
 * on the main thread (lazy-imported, so the landing bundle stays light) and
 * fires a blob download. The produced bytes and filename derive from the same
 * ExportModel the preview shows, so what the viewer displays is exactly what
 * the downloaded artifact carries.
 */
import type { ExportModel } from '@rowfolio/contracts';

// The canonical artifact filename — model-derived, identical to what the
// built .pptx/.xlsx carries. Preview surfaces must show THIS name rather
// than composing their own.
export { exportFileName } from '@rowfolio/export-model';

export type ExportFormat = 'pptx' | 'xlsx';

export interface DownloadedExport {
  filename: string;
  byteLength: number;
  mime: string;
  bytes: ArrayBuffer;
}

const noop = (): void => {};

/** Build the artifact without downloading it (used by preview surfaces that
 * also need the exact byte size / filename the real export will produce). */
export async function buildExportArtifact(model: ExportModel, format: ExportFormat): Promise<DownloadedExport> {
  const built =
    format === 'xlsx'
      ? await (await import('@rowfolio/export-xlsx')).buildWorkbook(model, noop)
      : await (await import('@rowfolio/export-pptx')).buildPresentation(model, noop);
  return {
    filename: built.metadata.filename,
    byteLength: built.metadata.byteLength,
    mime: built.metadata.mime,
    bytes: built.bytes,
  };
}

/** Build the artifact and fire the browser download. Resolves once the
 * anchor has been dispatched; the resolved values describe the artifact
 * (filename, size, mime, raw bytes). */
export async function downloadExport(model: ExportModel, format: ExportFormat): Promise<DownloadedExport> {
  const file = await buildExportArtifact(model, format);
  const url = URL.createObjectURL(new Blob([file.bytes], { type: file.mime }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename;
    anchor.rel = 'noopener';
    anchor.click();
  } finally {
    // Revoke on a later task: the download must read the blob first.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return file;
}
