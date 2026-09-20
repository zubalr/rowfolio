/**
 * React binding for the upload controller — `useSyncExternalStore` over the
 * framework-free state machine so re-renders track real state transitions.
 */
import { useState, useSyncExternalStore } from "react";
import { createUploadController } from "./controller.ts";
import type {
  UploadController,
  UploadControllerCallbacks,
  UploadPorts,
  UploadState,
} from "./types.ts";

export function useUploadController(
  ports: UploadPorts,
  callbacks?: UploadControllerCallbacks,
): { controller: UploadController; state: UploadState } {
  // Ports/callbacks are identity-stable per mount in the app shell; a new
  // controller per dependency change would silently drop in-flight work.
  const [controller] = useState(() => createUploadController(ports, callbacks ?? {}));
  const state = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
    () => controller.getState(),
  );
  return { controller, state };
}
