/**
 * Sample-only network interception helpers for Playwright tests.
 *
 * Rowfolio must never send source data off the browser. These helpers
 * provide (a) a request collector for tests that observe traffic, and
 * (b) an allowlist router that serves same-origin static assets and
 * fails/records everything else. The scan logic is pure and unit-tested
 * here; the Playwright glue is exercised by the e2e suite (A19+).
 */
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

export interface ObservedRequest {
  url: string;
  method: string;
  resourceType?: string;
  postData?: string | null;
}

export interface EgressPolicy {
  /** Origins allowed to be contacted at all (default: none). */
  allowedOrigins?: readonly string[];
  /** Path prefixes allowed on allowed origins (default: all). */
  allowedPathPrefixes?: readonly string[];
  /** Substrings that must never appear in a URL or body (canary tokens). */
  canaries?: readonly string[];
}

export interface EgressViolation {
  kind: 'cross-origin' | 'disallowed-method' | 'canary-in-url' | 'canary-in-body';
  url: string;
  method: string;
  detail: string;
}

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Pure scanner: classify every observed request against the egress policy. */
export function scanRequestsForEgress(
  requests: readonly ObservedRequest[],
  policy: EgressPolicy = {},
): EgressViolation[] {
  const origins = policy.allowedOrigins ?? [];
  const prefixes = policy.allowedPathPrefixes ?? ['/'];
  const canaries = policy.canaries ?? [];
  const violations: EgressViolation[] = [];
  for (const r of requests) {
    const url = r.url;
    const isDataOrBlob = url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:');
    if (!isDataOrBlob) {
      let originAllowed: boolean;
      try {
        const parsed = new URL(url);
        originAllowed = origins.includes(parsed.origin) && prefixes.some((p) => parsed.pathname.startsWith(p));
      } catch {
        originAllowed = false;
      }
      if (!originAllowed) {
        violations.push({ kind: 'cross-origin', url, method: r.method, detail: `origin not in allowlist ${JSON.stringify(origins)}` });
      }
      if (!SAFE_METHODS.has(r.method.toUpperCase())) {
        violations.push({ kind: 'disallowed-method', url, method: r.method, detail: `method ${r.method} is not a read-only fetch` });
      }
    }
    for (const c of canaries) {
      if (c && url.includes(c)) {
        violations.push({ kind: 'canary-in-url', url, method: r.method, detail: `canary token present in URL` });
      }
      if (c && r.postData !== null && r.postData !== undefined && r.postData.includes(c)) {
        violations.push({ kind: 'canary-in-body', url, method: r.method, detail: `canary token present in request body` });
      }
    }
  }
  return violations;
}

export function formatViolations(violations: readonly EgressViolation[]): string {
  return violations.map((v) => `${v.kind} ${v.method} ${v.url} — ${v.detail}`).join('\n');
}

/**
 * Playwright glue (typed loosely so this file loads without playwright):
 * attaches a request listener; call `stop()` to get all observed requests.
 */
export function collectRequests(page: {
  on(event: 'request', cb: (req: { url(): string; method(): string; resourceType(): string; postData(): string | null }) => void): void;
  off(event: 'request', cb: never): void;
}): { requests: ObservedRequest[]; stop(): ObservedRequest[] } {
  const requests: ObservedRequest[] = [];
  const handler = (req: { url(): string; method(): string; resourceType(): string; postData(): string | null }): void => {
    requests.push({ url: req.url(), method: req.method(), resourceType: req.resourceType(), postData: req.postData() });
  };
  page.on('request', handler);
  return { requests, stop: () => requests };
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
};

/**
 * Serve same-origin static files from `assetRoot` and abort everything
 * else. Use for e2e runs that must prove zero egress: any cross-origin or
 * non-GET request is aborted and recorded for post-run assertion.
 */
export function installStaticAllowlist(
  page: {
    route(pattern: string, handler: (route: unknown, request: unknown) => void): Promise<unknown> | unknown;
  },
  opts: { origin: string; assetRoot: string },
): { violations: EgressViolation[] } {
  const violations: EgressViolation[] = [];
  const record = (kind: EgressViolation['kind'], url: string, method: string, detail: string): void => {
    violations.push({ kind, url, method, detail });
  };
  void page.route('**/*', (route: unknown, request: unknown) => {
    const req = request as { url(): string; method(): string };
    const r = route as {
      fulfill(o: { status: number; path?: string; body?: string; contentType?: string }): Promise<unknown>;
      abort(): Promise<unknown>;
    };
    const url = req.url();
    const method = req.method().toUpperCase();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      record('cross-origin', url, method, 'unparseable URL');
      void r.abort();
      return;
    }
    if (parsed.origin !== opts.origin) {
      record('cross-origin', url, method, `origin ${parsed.origin} != ${opts.origin}`);
      void r.abort();
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      record('disallowed-method', url, method, 'only GET/HEAD served by static allowlist');
      void r.abort();
      return;
    }
    const rel = normalize(decodeURIComponent(parsed.pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
    const file = join(opts.assetRoot, rel === '' ? 'index.html' : rel);
    if (!file.startsWith(opts.assetRoot) || !existsSync(file) || !statSync(file).isFile()) {
      void r.fulfill({ status: 404, body: 'not found' });
      return;
    }
    void r.fulfill({ status: 200, path: file, contentType: MIME[extname(file)] ?? 'application/octet-stream' });
  });
  return { violations };
}
