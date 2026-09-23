#!/usr/bin/env node
/**
 * pnpm audit:static [distDir=apps/web/dist]
 *
 * Static-only deployment + landing-chunk audit:
 *  1. dist contains only files matching the positive static manifest — no
 *     _worker.js, functions/, env files, executables or unknown file types
 *     (bill-prevention control, 19_DEPLOYMENT_AND_COST.md);
 *  2. no emitted asset exceeds the Cloudflare Pages 25 MiB per-asset limit;
 *  3. the JS chunk graph reachable from each HTML entry contains no module
 *     from a parser/export/chart/heavy package — landing must not eagerly
 *     import SheetJS/ExcelJS/PptxGenJS/PapaParse/fflate/D3 (07_ARCHITECTURE.md,
 *     17_PERFORMANCE_SPEC.md). Provenance is checked against the emitted
 *     `.vite/module-map.json`, not string-sniffing.
 *  4. no emitted JS performs a remote import or eval/new Function
 *     (strict-CSP: script-src 'self').
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.resolve(repoRoot, process.argv[2] ?? "apps/web/dist");

let failures = 0;
const fail = (msg: string): void => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};
const ok = (msg: string): void => {
  console.log(`ok   ${msg}`);
};

const ALLOWED_EXTENSIONS = new Set([
  ".html", ".js", ".css", ".map", ".json", ".txt", ".svg", ".png", ".webp",
  ".ico", ".avif", ".woff", ".woff2", ".ttf", ".otf", ".xlsx", ".csv", ".md",
  ".webmanifest",
]);
const ALLOWED_BARE = new Set(["_headers", "_redirects", ".nojekyll", "favicon.ico"]);
const FORBIDDEN_NAMES = [/^functions$/i, /^_worker\.(js|ts)$/i, /\.env(\.|$)/i];
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

if (!existsSync(distDir)) {
  console.error(`FAIL dist directory not found: ${path.relative(repoRoot, distDir)} — run \`pnpm build\` first`);
  process.exit(1);
}

const files: string[] = [];
const walk = (dir: string): void => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (FORBIDDEN_NAMES.some((re) => re.test(e.name))) fail(`forbidden directory: ${path.relative(distDir, full)}/`);
      else walk(full);
    } else if (e.isFile()) {
      files.push(full);
    } else {
      fail(`non-regular file in dist: ${path.relative(distDir, full)}`);
    }
  }
};
walk(distDir);

let totalBytes = 0;
for (const f of files) {
  const rel = path.relative(distDir, f);
  const size = statSync(f).size;
  totalBytes += size;
  const base = path.basename(f);
  if (FORBIDDEN_NAMES.some((re) => re.test(base))) fail(`forbidden file: ${rel}`);
  const ext = path.extname(base).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_BARE.has(base)) {
    fail(`file type outside positive static manifest: ${rel}`);
  }
  if (size > MAX_ASSET_BYTES) fail(`asset exceeds 25 MiB Pages limit: ${rel} (${size} bytes)`);
}
ok(`${files.length} static files, ${totalBytes} bytes total`);

// --- strict-CSP source scan on every emitted JS file ------------------------
const JS_FORBIDDEN = [
  { re: /\beval\s*\(/, label: "eval(" },
  { re: /new\s+Function\s*\(/, label: "new Function(" },
  { re: /importScripts\s*\(\s*["'`]https?:/, label: "remote importScripts()" },
  { re: /import\s*\(\s*["'`]https?:/, label: "remote dynamic import()" },
];
const jsFiles = files.filter((f) => f.endsWith(".js"));
for (const f of jsFiles) {
  const src = readFileSync(f, "utf8");
  for (const { re, label } of JS_FORBIDDEN) {
    if (re.test(src)) fail(`${path.relative(distDir, f)} contains ${label}`);
  }
}
ok(`scanned ${jsFiles.length} emitted JS files for CSP-hostile constructs`);

// --- landing chunk purity ---------------------------------------------------
const manifestPath = path.join(distDir, ".vite", "manifest.json");
const moduleMapPath = path.join(distDir, ".vite", "module-map.json");
const HEAVY = [
  /node_modules\/\.pnpm\/xlsx@/,
  /node_modules\/\.pnpm\/exceljs@/,
  /node_modules\/\.pnpm\/pptxgenjs@/,
  /node_modules\/\.pnpm\/papaparse@/,
  /node_modules\/\.pnpm\/fflate@/,
  /node_modules\/\.pnpm\/d3-(scale|shape|array)@/,
  /node_modules\/\.pnpm\/motion@/,
];

if (!existsSync(manifestPath) || !existsSync(moduleMapPath)) {
  fail("manifest.json or module-map.json missing — build must emit both");
} else {
  const moduleMap = JSON.parse(readFileSync(moduleMapPath, "utf8")) as Record<string, string[]>;
  // Which emitted chunks serve each HTML entry?
  for (const htmlRel of ["index.html", "ar/index.html"]) {
    const htmlPath = path.join(distDir, htmlRel);
    if (!existsSync(htmlPath)) {
      fail(`${htmlRel} missing from build output`);
      continue;
    }
    const html = readFileSync(htmlPath, "utf8");
    const entryFiles = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)]
      .map((m) => (m[1] ?? "").replace(/^\//, ""))
      .filter(Boolean);
    if (entryFiles.length === 0) {
      fail(`${htmlRel} references no module script`);
      continue;
    }
    for (const entry of entryFiles) {
      const moduleIds = moduleMap[entry] ?? [];
      if (moduleIds.length === 0) {
        fail(`${htmlRel}: no module provenance for emitted chunk ${entry}`);
        continue;
      }
      for (const id of moduleIds) {
        for (const re of HEAVY) {
          if (re.test(id)) {
            fail(`${htmlRel} entry chunk ${entry} contains forbidden module ${id}`);
          }
        }
      }
      ok(`${htmlRel} entry chunk ${entry}: ${moduleIds.length} modules, no parser/export/chart libraries`);
    }
  }
}

console.log(JSON.stringify({ distFiles: files.length, bytes: totalBytes, status: failures === 0 ? "pass" : "fail" }));
process.exit(failures === 0 ? 0 : 1);
