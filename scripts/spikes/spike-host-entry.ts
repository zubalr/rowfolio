// Host entry for the worker spike. Vite detects the
// `new Worker(new URL(...), { type: "module" })` pattern and emits the worker
// as a separate same-origin ES module chunk — loadable under
// `worker-src 'self'` with no blob:/data: URL.
export function startExportWorker(): Worker {
  return new Worker(new URL("./export-worker-entry.ts", import.meta.url), {
    type: "module",
  });
}

const host = document.getElementById("out");
if (host) host.textContent = "spike host ready";
