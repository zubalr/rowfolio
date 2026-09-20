/**
 * E2E Test Fixtures & Static Server Helper (A19)
 *
 * Serves the built static artifact (`apps/web/dist`) on port 4173 if not already running,
 * respecting Cloudflare Pages _headers (strict CSP, cache controls, nosniff).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axe from "axe-core";
import type { Page } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DIST_DIR = path.resolve(repoRoot, "apps/web/dist");

export const VIEWPORTS = {
  minMobile: { width: 320, height: 640 },
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

let serverInstance: http.Server | null = null;

export async function ensureStaticServer(port = 4173): Promise<void> {
  // Check if port is already active
  const isListening = await new Promise<boolean>((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, () => resolve(true));
    req.on("error", () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });

  if (isListening) return;

  // Start lightweight static server
  serverInstance = http.createServer((req, res) => {
    const rawUrl = req.url ?? "/";
    const pathname = rawUrl.split("?")[0] ?? "/";

    let filePath = path.join(DIST_DIR, pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    // Strict CSP and security headers from spec
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });

    fs.createReadStream(filePath).pipe(res);
  });

  // unref server so worker processes exit cleanly
  serverInstance.unref();

  await new Promise<void>((resolve, reject) => {
    serverInstance?.listen(port, "127.0.0.1", () => resolve());
    serverInstance?.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Another parallel worker started it in the race window
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

export function stopStaticServer(): void {
  // Let Node process exit naturally without killing server across workers
}

export async function runAxeAudit(page: Page): Promise<{
  violations: axe.Result[];
  passes: axe.Result[];
}> {
  // Use evaluate to load axe directly in the page V8 isolate without violating strict CSP script-src 'self'
  await page.evaluate(axe.source);
  return await page.evaluate(async () => {
    const axeGlobal = (window as unknown as { axe: typeof axe }).axe;
    const results = await axeGlobal.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return {
      violations: results.violations,
      passes: results.passes,
    };
  });
}
