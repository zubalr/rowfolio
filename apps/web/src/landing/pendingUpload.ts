/**
 * In-memory handoff slots between the landing surface and the workspace
 * route (`#/workspace`, composed by the app/session owner A11).
 *
 * Nothing here touches storage, URLs or the network — an upload chosen on
 * the landing lives only in this module's volatile memory until the
 * workspace session claims it with `takeWorkspaceIntent`. Cleared on full
 * reload, which matches the no-persistence product decision.
 */
export type WorkspaceIntent =
  | { readonly kind: "sample" }
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
