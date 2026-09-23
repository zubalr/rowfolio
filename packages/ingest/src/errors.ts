/**
 * Typed, actionable ingestion failures.
 *
 * The error `code` is the exact `WorkerResponse.error.code` vocabulary of the
 * worker contract (worker-response.schema.json). `messageKey` always names a
 * declared translation key (`error.<CODE>`), so the UI can render localized
 * copy without a new catalog entry. `detail` is a stable machine-readable
 * qualifier (e.g. 'zip.encrypted-entry', 'csv.ambiguous-delimiter') — never a
 * source value, path or cell content — for diagnostics and future dedicated
 * locale keys.
 */

export type IngestErrorCode =
  | 'INVALID_FILE'
  | 'LIMIT_EXCEEDED'
  | 'AMBIGUOUS_INPUT'
  | 'UNSUPPORTED'
  | 'CANCELLED'
  | 'SCHEMA_MISMATCH'
  | 'INTERNAL';

export interface IngestErrorInit {
  /** Stable qualifier for the failure, e.g. 'zip.path-traversal'. Never carries source content. */
  readonly detail: string;
  /** Override the default recoverability for the code. */
  readonly recoverable?: boolean;
}

const RECOVERABLE: Record<IngestErrorCode, boolean> = {
  INVALID_FILE: true,
  LIMIT_EXCEEDED: true,
  AMBIGUOUS_INPUT: true,
  UNSUPPORTED: true,
  CANCELLED: true,
  SCHEMA_MISMATCH: false,
  INTERNAL: false,
};

export class IngestError extends Error {
  readonly code: IngestErrorCode;
  readonly detail: string;
  readonly recoverable: boolean;

  constructor(code: IngestErrorCode, init: IngestErrorInit) {
    super(`${code}:${init.detail}`);
    this.name = 'IngestError';
    this.code = code;
    this.detail = init.detail;
    this.recoverable = init.recoverable ?? RECOVERABLE[code];
  }
}

export function isIngestError(value: unknown): value is IngestError {
  return value instanceof IngestError;
}

/** Every code that can reach a worker error response (TIMEOUT/EXPORT_FAILED are supervisor-side). */
export type WorkerErrorCode = IngestErrorCode | 'TIMEOUT' | 'EXPORT_FAILED';

const WIRE_CODES = new Set<string>([
  'INVALID_FILE',
  'LIMIT_EXCEEDED',
  'AMBIGUOUS_INPUT',
  'UNSUPPORTED',
  'CANCELLED',
  'TIMEOUT',
  'EXPORT_FAILED',
  'SCHEMA_MISMATCH',
  'INTERNAL',
]);

/**
 * Map any thrown value to the wire error shape. Source text, stacks and file
 * internals never cross this boundary — only the code, its declared
 * translation key, recoverability and a content-free detail qualifier.
 * Foreign structured errors (WorkerRequestError, SupervisorError) keep their
 * declared code so a worker-side CANCELLED/TIMEOUT is not relabelled INTERNAL.
 */
export function toWorkerError(error: unknown): {
  code: WorkerErrorCode;
  messageKey: string;
  recoverable: boolean;
  detail: string;
} {
  if (isIngestError(error)) {
    return {
      code: error.code,
      messageKey: `error.${error.code}`,
      recoverable: error.recoverable,
      detail: error.detail,
    };
  }
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && WIRE_CODES.has(code)) {
    const messageKey = (error as { messageKey?: unknown })?.messageKey;
    const detail = (error as { detail?: unknown })?.detail;
    const recoverable = (error as { recoverable?: unknown })?.recoverable;
    return {
      code: code as WorkerErrorCode,
      messageKey: typeof messageKey === 'string' ? messageKey : `error.${code}`,
      recoverable: typeof recoverable === 'boolean' ? recoverable : code !== 'INTERNAL' && code !== 'SCHEMA_MISMATCH',
      detail: typeof detail === 'string' ? detail : code.toLowerCase(),
    };
  }
  return {
    code: 'INTERNAL',
    messageKey: 'error.INTERNAL',
    recoverable: false,
    detail: 'unexpected-internal',
  };
}
