#!/usr/bin/env node
/**
 * pnpm spike:workers [--browser]
 *
 * Builds a tiny module worker importing exceljs@4.4.0 + pptxgenjs@4.0.1 with
 * the production Vite toolchain, then proves:
 *  - a separate same-origin worker chunk is emitted (worker-src 'self' safe);
 *  - the emitted chunks contain no eval / new Function / remote import /
 *    importScripts / blob: or data: module URLs (strict CSP: default-src
 *    'self', script-src 'self', worker-src 'self');
 *  - with --browser: the worker actually runs inside Chrome under the shipped
 *    strict CSP and returns real XLSX and PPTX ZIP artifacts (PK\x03\x04
 *    magic) over postMessage with transferred ArrayBuffers.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const spikeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(spikeDir, "..", "..");
const outDir = path.join(repoRoot, "node_modules", ".cache", "rowfolio-worker-spike");
const wantBrowser = process.argv.includes("--browser") || process.env.SPIKE_BROWSER === "1";

let failures = 0;
const fail = (m: string): void => {
  failures += 1;
  console.error(`FAIL ${m}`);
};
const ok = (m: string): void => {
  console.log(`ok   ${m}`);
};

// --- 1. build ---------------------------------------------------------------
// Resolve exceljs/pptxgenjs from the workspace packages that own them so the
// spike bundles exactly the pinned, lockfile-verified versions.
import { realpathSync } from "node:fs";
const depDir = (pkgDir: string, name: string): string =>
  realpathSync(path.join(repoRoot, pkgDir, "node_modules", name));
const alias = {
  exceljs: depDir("packages/export-xlsx", "exceljs"),
  pptxgenjs: depDir("packages/export-pptx", "pptxgenjs"),
};

const { build } = await import("vite");
rmSync(outDir, { recursive: true, force: true });
await build({
  root: spikeDir,
  configFile: false,
  logLevel: "warn",
  resolve: { alias },
  build: {
    outDir,
    emptyOutDir: true,
    manifest: true,
    rollupOptions: { input: { spike: path.join(spikeDir, "index.html") } },
  },
  worker: { format: "es" },
});
ok(`vite built worker spike into ${path.relative(repoRoot, outDir)}`);

// --- 2. identify worker chunk(s) --------------------------------------------
const files: string[] = [];
const walk = (d: string): void => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(outDir);
const html = readFileSync(path.join(outDir, "index.html"), "utf8");
const hostChunks = new Set(
  [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => (m[1] ?? "").replace(/^\.?\//, "")),
);
const jsFiles = files.filter((f) => f.endsWith(".js"));
const workerChunks = jsFiles.filter((f) => !hostChunks.has(path.relative(outDir, f)));
if (workerChunks.length === 0) {
  fail("no separate worker chunk emitted");
} else {
  ok(`worker chunk(s) emitted separately: ${workerChunks.map((f) => path.relative(outDir, f)).join(", ")}`);
}

// --- 3. strict-CSP static assertions ----------------------------------------
const CSP_FORBIDDEN = [
  { re: /\beval\s*\(/, label: "eval(" },
  { re: /new\s+Function\s*\(/, label: "new Function(" },
  { re: /(?<![\w$.])importScripts\s*\(/, label: "importScripts() call (classic-worker remote loading)" },
  { re: /import\s*\(\s*["'`]https?:/, label: "remote dynamic import()" },
  { re: /new\s+Worker\s*\(\s*["'`]blob:/, label: "blob: worker URL" },
];
for (const f of jsFiles) {
  const src = readFileSync(f, "utf8");
  for (const { re, label } of CSP_FORBIDDEN) {
    if (re.test(src)) fail(`${path.relative(outDir, f)} contains ${label}`);
  }
}
ok("emitted chunks contain no CSP-hostile constructs");

// --- 4. real-browser leg -----------------------------------------------------
function findChrome() {
  for (const bin of ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"]) {
    try {
      const p = execFileSync("which", [bin], { encoding: "utf8" }).trim();
      if (p) return p;
    } catch {
      /* not found */
    }
  }
  return null;
}

const CSP =
  "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
  "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self'; connect-src 'self'; worker-src 'self'; form-action 'none'";

let browserStatus = "skipped (pass --browser or SPIKE_BROWSER=1)";
if (wantBrowser) {
  const chromePath = findChrome();
  if (!chromePath) {
    browserStatus = "skipped (no Chrome executable found)";
  } else if (workerChunks.length > 0 && workerChunks[0]) {
    const workerPath = `/${path.relative(outDir, workerChunks[0])}`;

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const file = path.join(outDir, rel);
      if (!file.startsWith(outDir) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404).end("not found");
        return;
      }
      const ext = path.extname(file);
      const type =
        ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : "application/octet-stream";
      res.writeHead(200, { "content-type": type, "content-security-policy": CSP });
      res.end(readFileSync(file));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;

    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ executablePath: chromePath });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await page.goto(`http://127.0.0.1:${port}/index.html`);

      interface SpikeResult {
        ok: boolean;
        error?: string | undefined;
        xlsxHead?: number[] | null | undefined;
        pptxHead?: number[] | null | undefined;
        xlsxBytes?: number | undefined;
        pptxBytes?: number | undefined;
      }
      const result = await page.evaluate(async (workerUrl: string): Promise<SpikeResult> => {
        const worker = new Worker(workerUrl, { type: "module" });
        return await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), 60_000);
          worker.onerror = (e) => {
            clearTimeout(timer);
            resolve({ ok: false, error: `worker error: ${e.message}` });
          };
          worker.onmessage = (e) => {
            clearTimeout(timer);
            const { ok, xlsx, pptx, error } = e.data as {
            ok: boolean;
            xlsx?: ArrayBuffer;
            pptx?: ArrayBuffer;
            error?: string;
          };
            resolve({
              ok,
              error,
              xlsxHead: xlsx ? [...new Uint8Array(xlsx.slice(0, 4))] : null,
              pptxHead: pptx ? [...new Uint8Array(pptx.slice(0, 4))] : null,
              xlsxBytes: xlsx?.byteLength ?? 0,
              pptxBytes: pptx?.byteLength ?? 0,
            });
          };
          worker.postMessage("run");
        });
      }, workerPath);

      const PK = [0x50, 0x4b, 0x03, 0x04];
      if (!result.ok) {
        fail(`worker execution failed: ${result.error ?? "unknown"}`);
      } else if (
        JSON.stringify(result.xlsxHead) !== JSON.stringify(PK) ||
        JSON.stringify(result.pptxHead) !== JSON.stringify(PK) ||
        !((result.xlsxBytes ?? 0) > 0 && (result.pptxBytes ?? 0) > 0)
      ) {
        fail("artifacts missing ZIP PK\\x03\\x04 magic or empty");
      } else {
        ok(`worker produced real artifacts under strict CSP: xlsx=${result.xlsxBytes}B pptx=${result.pptxBytes}B (both PK\\x03\\x04)`);
      }
      const cspViolations = errors.filter((e) => /content security policy|violates/i.test(e));
      if (cspViolations.length) fail(`CSP violations: ${cspViolations.join(" | ")}`);
      browserStatus = `ran via ${chromePath}`;
    } finally {
      await browser.close();
      server.close();
    }
  }
}

console.log(JSON.stringify({ workerChunks: workerChunks.length, browser: browserStatus, status: failures === 0 ? "pass" : "fail" }));
process.exit(failures === 0 ? 0 : 1);
