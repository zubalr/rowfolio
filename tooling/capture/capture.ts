#!/usr/bin/env node
/**
 * Release-candidate screenshot capture.
 *
 * Captures PNGs of an explicitly provided URL — either a single shot or a
 * scripted journey — and writes a provenance metadata record (URL, commit,
 * viewport, user agent, timestamp, image hash and dimensions) alongside each
 * image. Built for producing release-candidate media from a shipped candidate
 * build — never for asserting unimplemented behavior.
 *
 * Required arguments:
 *   --url URL       http(s) base URL to capture (no default; no automatic
 *                   dev server)
 *   --out DIR       output directory. Refused inside the repository except
 *                   tooling/capture/captures/ (git-ignored) so generated
 *                   media never enters Git.
 *   --commit SHA    the commit the captured build corresponds to
 *
 * Optional:
 *   --name NAME       output basename (single-shot mode)
 *   --viewport WxH    default 1440x1000
 *   --full-page       capture the full scrollable page (single-shot mode)
 *   --timeout-ms N    navigation timeout (default 30000)
 *   --journey NAME    scripted journey mode: landing | guide |
 *                     workspace-sample | upload (see journeys.ts). Emits one
 *                     PNG + metadata record per step; a step whose control
 *                     never appears records an explicit UNAVAILABLE marker.
 *   --locale en|ar    journey locale: picks the / or /ar/ entry path
 *   --upload-file F   file handed to the upload journey's file input
 *   --reduced-motion  emulate prefers-reduced-motion: reduce
 *   --keyboard-probe  record the focused element in each step's metadata
 *
 * Examples:
 *   node tooling/capture/capture.ts --url https://example.com/candidate \
 *     --commit $(git rev-parse HEAD) --out tooling/capture/captures
 *   node tooling/capture/capture.ts --url http://127.0.0.1:4543 \
 *     --commit $(git rev-parse HEAD) --out tooling/capture/captures \
 *     --journey landing --locale ar --viewport 390x844
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const allowedRepoOut = resolve(repoRoot, 'tooling/capture/captures');

const KNOWN_JOURNEYS = ['landing', 'guide', 'workspace-sample', 'upload'];

function parseArgs(argv) {
  const args = {
    name: 'capture',
    viewport: '1440x1000',
    fullPage: false,
    timeoutMs: 30000,
    locale: 'en',
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
      case '--journey': args.journey = argv[++i]; break;
      case '--locale': args.locale = argv[++i]; break;
      case '--upload-file': args.uploadFile = argv[++i]; break;
      case '--reduced-motion': args.reducedMotion = true; break;
      case '--keyboard-probe': args.keyboardProbe = true; break;
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
  if (args.journey !== undefined && !KNOWN_JOURNEYS.includes(args.journey)) {
    fail(`unknown --journey "${args.journey}" (known: ${KNOWN_JOURNEYS.join(', ')})`);
  }
  if (args.locale !== undefined && !['en', 'ar'].includes(args.locale)) {
    fail(`invalid --locale "${args.locale}" (en|ar)`);
  }

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

  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    fail(`could not launch Chromium (${error.message?.split('\n')[0]}). Install it with: pnpm exec playwright install chromium`);
  }

  try {
    if (args.journey) {
      const { runJourney } = await import('./journeys.ts');
      const results = await runJourney(browser, {
        baseUrl: args.url,
        commit: args.commit,
        outDir,
        locale: args.locale,
        width: viewport.width,
        height: viewport.height,
        journey: args.journey,
        reducedMotion: args.reducedMotion === true,
        keyboardProbe: args.keyboardProbe === true,
        uploadFile: args.uploadFile,
        timeoutMs: args.timeoutMs,
      });
      const unavailable = results.filter((r) => !r.ok);
      console.log(JSON.stringify({ journey: args.journey, locale: args.locale, viewport, steps: results.length, unavailable: unavailable.length, results }, null, 2));
      // Explicit unavailability is evidence, not a silent pass; exit 0 so a
      // matrix driver can continue, the JSON names every unavailable step.
      return;
    }

    const pngPath = resolve(outDir, `${args.name}.png`);
    const metaPath = resolve(outDir, `${args.name}.metadata.json`);
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
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => fail(error?.message ?? String(error)));
