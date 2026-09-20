#!/usr/bin/env node
/**
 * Release-candidate screenshot capture.
 *
 * Captures a PNG of an explicitly provided URL and writes a metadata record
 * (URL, commit, viewport, user agent, timestamp, image hash and dimensions)
 * alongside it. Built for producing release-candidate media from a shipped
 * candidate build — never for asserting unimplemented behavior.
 *
 * Required arguments:
 *   --url URL       http(s) URL to capture (no default; no automatic dev server)
 *   --out DIR       output directory. Refused inside the repository except
 *                   tooling/capture/captures/ (git-ignored) so generated
 *                   media never enters Git.
 *   --commit SHA    the commit the captured build corresponds to
 *
 * Optional:
 *   --name NAME     output basename (default: capture)
 *   --viewport WxH  default 1440x1000
 *   --full-page     capture the full scrollable page
 *   --timeout-ms N  navigation timeout (default 30000)
 *
 * Example:
 *   node tooling/capture/capture.ts --url https://example.com/candidate \
 *     --commit $(git rev-parse HEAD) --out tooling/capture/captures
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const allowedRepoOut = resolve(repoRoot, 'tooling/capture/captures');

function parseArgs(argv) {
  const args = {
    name: 'capture',
    viewport: '1440x1000',
    fullPage: false,
    timeoutMs: 30000,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--url': args.url = argv[++i]; break;
      case '--out': args.out = argv[++i]; break;
      case '--commit': args.commit = argv[++i]; break;
      case '--name': args.name = argv[++i]; break;
      case '--viewport': args.viewport = argv[++i]; break;
      case '--full-page': args.fullPage = true; break;
      case '--timeout-ms': args.timeoutMs = Number(argv[++i]); break;
      default: throw new Error(`unknown argument: ${flag}`);
    }
  }
  return args;
}

function fail(message) {
  console.error(`capture: ${message}`);
  process.exit(2);
}

function parseViewport(text) {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(text ?? '');
  if (!match) fail(`invalid --viewport "${text}", expected WxH (e.g. 1440x1000)`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 200 || height < 200 || width > 7680 || height > 4320) {
    fail('viewport outside supported 200..7680 x 200..4320 range');
  }
  return { width, height };
}

function pngDimensions(bytes) {
  // PNG: 8-byte signature, IHDR length+type (8 bytes), width/height (8 bytes)
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) fail('--url is required (capture nothing by accident)');
  let parsedUrl;
  try {
    parsedUrl = new URL(args.url);
  } catch {
    fail(`--url "${args.url}" is not a valid URL`);
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    fail('only http(s) URLs are supported');
  }
  if (!args.commit) fail('--commit is required (records which build was captured)');
  if (!args.out) fail('--out is required');

  const outDir = isAbsolute(args.out) ? resolve(args.out) : resolve(process.cwd(), args.out);
  if (outDir.startsWith(repoRoot) && !outDir.startsWith(allowedRepoOut)) {
    fail(`--out ${outDir} is inside the repository; use ${allowedRepoOut} (git-ignored) or a path outside the repo`);
  }

  const viewport = parseViewport(args.viewport);

  let chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    fail('Playwright is not installed; run: pnpm install --frozen-lockfile');
  }

  mkdirSync(outDir, { recursive: true });
  const pngPath = resolve(outDir, `${args.name}.png`);
  const metaPath = resolve(outDir, `${args.name}.metadata.json`);

  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    fail(`could not launch Chromium (${error.message?.split('\n')[0]}). Install it with: pnpm exec playwright install chromium`);
  }
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(args.url, { waitUntil: 'networkidle', timeout: args.timeoutMs });
    const buffer = await page.screenshot({ path: pngPath, fullPage: args.fullPage });
    const dimensions = pngDimensions(buffer);
    const metadata = {
      url: args.url,
      finalUrl: page.url(),
      commit: args.commit,
      capturedAt: new Date().toISOString(),
      userAgent: await page.evaluate(() => navigator.userAgent),
      browserVersion: browser.version(),
      viewport,
      fullPage: args.fullPage,
      image: {
        path: pngPath,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        bytes: buffer.length,
        dimensions,
      },
    };
    writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);
    // sanity: metadata file readable and png hash stable
    const recorded = JSON.parse(readFileSync(metaPath, 'utf-8'));
    if (recorded.image.sha256 !== metadata.image.sha256) fail('metadata hash mismatch after write');
    console.log(`captured ${pngPath}`);
    console.log(`metadata ${metaPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => fail(error?.message ?? String(error)));
