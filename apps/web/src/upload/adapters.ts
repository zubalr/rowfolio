/**
 * Real adapter bindings for the upload flow.
 *
 * `ingestPorts()` wires the actual `@rowfolio/ingest` bounded adapters
 * (`inspectSource` + `parseSource`). The composition root (apps/web/src/app,
 * task A11) may substitute worker-transport equivalents with identical
 * signatures — these are the real in-process defaults, never stubs.
 *
 * `ports.profile` is intentionally absent here: it is the contract
 * `profileTable` owned by `packages/normalize` (A06). Callers supply it — the
 * flow does not ship a fallback profiler.
 */
import { inspectSource, parseSource } from "@rowfolio/ingest";
import type { UploadPorts } from "./types.ts";

export function ingestPorts(): Pick<UploadPorts, "inspect" | "parse"> {
  return {
    inspect: (bytes, sourceName, options, progress) =>
      inspectSource(bytes, sourceName, options, progress),
    parse: (bytes, sourceName, options, progress, extras) =>
      parseSource(bytes, sourceName, options, progress ?? (() => {}), extras ?? {}),
  };
}
