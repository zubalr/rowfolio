import { sha256Hex, type AnalysisSnapshot, type Hash } from '@rowfolio/contracts';
import { checkSchema } from '@rowfolio/contracts';

export interface SampleIndex {
  schemaVersion: string;
  datasetId: string;
  assets: {
    workbook: {
      file: string;
      mime: string;
      sha256: string;
      sourceSheet: string;
      sourceSheetId: string;
      headerRow: number;
    };
    manifest: { file: string; mime: string };
    preparedSnapshot?: { file: string; mime: string; status: string };
  };
}

/** Manifest-approved ingest options for the bundled workbook. */
export interface SampleAssets {
  index: SampleIndex;
  workbookBytes: ArrayBuffer;
  workbookHash: Hash;
  workbookName: string;
  /** Parse options bound by index.json (sheet + header row). */
  parseOptions: { selectedSheetId: string; headerRow: number; allowHiddenSheet: boolean };
  /** Validated prepared snapshot when present and bound; null → live pipeline. */
  preparedSnapshot: AnalysisSnapshot | null;
}

export class SampleError extends Error {
  readonly code: 'INVALID_FILE' | 'LIMIT_EXCEEDED' | 'UNSUPPORTED' | 'SCHEMA_MISMATCH' | 'INTERNAL';
  readonly messageKey: string;
  constructor(code: SampleError['code'], detail: string) {
    super(detail);
    this.name = 'SampleError';
    this.code = code;
    this.messageKey = `error.${code}`;
  }
}

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown> }>;

const SAMPLE_BASE = `${import.meta.env.BASE_URL}sample`;

async function fetchJson(fetchLike: FetchLike, url: string): Promise<unknown> {
  const res = await fetchLike(url);
  if (!res.ok) throw new SampleError('INVALID_FILE', `fetch ${url} → ${res.status}`);
  return res.json();
}

async function fetchBytes(fetchLike: FetchLike, url: string): Promise<ArrayBuffer> {
  const res = await fetchLike(url);
  if (!res.ok) throw new SampleError('INVALID_FILE', `fetch ${url} → ${res.status}`);
  return res.arrayBuffer();
}

/**
 * Load the bundled sample: fetch index.json, fetch the workbook, verify its
 * SHA-256 against the bound value, and — when a prepared snapshot is shipped —
 * validate it against the AnalysisSnapshot schema and the workbook hash binding.
 * A hash mismatch or invalid payload is a hard failure (never a silent mock).
 */
export async function loadSampleAssets(fetchLike: FetchLike = fetch as unknown as FetchLike): Promise<SampleAssets> {
  const index = (await fetchJson(fetchLike, `${SAMPLE_BASE}/index.json`)) as SampleIndex;
  const workbook = index?.assets?.workbook;
  if (!workbook?.file || typeof workbook.sha256 !== 'string') {
    throw new SampleError('SCHEMA_MISMATCH', 'sample index missing workbook asset');
  }

  const workbookBytes = await fetchBytes(fetchLike, `${SAMPLE_BASE}/${workbook.file}`);
  const workbookHash = await sha256Hex(workbookBytes);
  if (workbookHash !== workbook.sha256) {
    throw new SampleError('SCHEMA_MISMATCH', `workbook hash mismatch: expected ${workbook.sha256}, got ${workbookHash}`);
  }

  let preparedSnapshot: AnalysisSnapshot | null = null;
  const prepared = index.assets.preparedSnapshot;
  if (prepared && prepared.status === 'ready') {
    const raw = await fetchJson(fetchLike, `${SAMPLE_BASE}/${prepared.file}`);
    const envelope = raw as { snapshot?: unknown; sourceHash?: string };
    const snapshot = envelope?.snapshot ?? envelope;
    const issues = checkSchema('AnalysisSnapshot', snapshot);
    if (issues.length === 0) {
      const candidate = snapshot as AnalysisSnapshot;
      if (candidate.sourceHash === workbookHash) {
        preparedSnapshot = candidate;
      }
      // A prepared snapshot bound to different bytes is ignored — the live
      // pipeline remains the authority for the shipped workbook.
    }
  }

  return {
    index,
    workbookBytes,
    workbookHash,
    workbookName: workbook.file,
    parseOptions: {
      selectedSheetId: workbook.sourceSheetId,
      headerRow: workbook.headerRow,
      allowHiddenSheet: false,
    },
    preparedSnapshot,
  };
}
