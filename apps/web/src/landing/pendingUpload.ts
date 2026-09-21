/**
 * In-memory handoff slots between the landing surface and the workspace
 * route (`#/workspace`, composed by the app/session owner A11).
 *
 * Nothing here touches storage, URLs or the network — an upload chosen on
 * the landing lives only in this module's volatile memory until the
 * workspace session claims it with `takeWorkspaceIntent`. Cleared on full
 * reload, which matches the no-persistence product decision.
 */
/** A format the workspace should generate and hand to the visitor on arrival. */
export type IntentDownload = "xlsx" | "pptx";

export type WorkspaceIntent =
  | {
      readonly kind: "sample";
      /**
       * Set by the landing's Download actions: once the sample session is
       * committed the workspace runs the export pipeline and fires the real
       * file — the dialog stays open so both artifacts remain reachable.
       */
      readonly download?: IntentDownload;
    }
  | { readonly kind: "upload"; readonly file: File }
  | { readonly kind: "guide" };

let pending: WorkspaceIntent | null = null;

export function setWorkspaceIntent(intent: WorkspaceIntent): void {
  pending = intent;
}

/** Consume the pending intent once — returns null when nothing was set. */
export function takeWorkspaceIntent(): WorkspaceIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}

/**
 * A file the app-level upload path could not resolve alone (e.g. an
 * ambiguous CSV delimiter) — handed to the upload flow's configure stage
 * so its picker renders instead of a dead-end error banner. Bytes travel
 * directly; no File wrapper is needed at this seam.
 */
export interface PendingPickerFile {
  readonly name: string;
  readonly bytes: ArrayBuffer;
}

let pendingPicker: PendingPickerFile | null = null;

export function setPendingPickerFile(file: PendingPickerFile): void {
  pendingPicker = file;
}

/** Consume the file awaiting the delimiter/configure picker. */
export function takePendingPickerFile(): PendingPickerFile | null {
  const file = pendingPicker;
  pendingPicker = null;
  return file;
}
