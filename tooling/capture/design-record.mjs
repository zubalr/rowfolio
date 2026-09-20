/**
 * design-record.mjs — ~40 s interaction recordings, one per locale.
 * EN: landing scroll → demo → ready → evidence → export dialog.
 * AR: landing scroll → CSV upload → review → ready → evidence.
 * Env overrides: BASE, OUT, REPO — see design-capture.mjs.
 */
/* global window */
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
const REPO_ROOT = new URL('../..', import.meta.url).pathname;
const require = createRequire(`${REPO_ROOT}/package.json`);
const { chromium } = require('@playwright/test');
const REPO = path.resolve(process.env.REPO ?? REPO_ROOT);
const CSV = path.join(REPO, 'fixtures/sample/sample_operations.csv');
const OUT = path.resolve(process.env.OUT ?? path.join(REPO, 'tooling/capture/captures/design'));
const BASE = process.env.BASE ?? 'http://localhost:5173';
mkdirSync(`${OUT}/video-final-en`, { recursive: true });
mkdirSync(`${OUT}/video-final-ar`, { recursive: true });
const browser = await chromium.launch();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function record(name, base, act) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: `${OUT}/video-final-${name}`, size: { width: 1440, height: 900 } },
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'networkidle' });
  await act(page);
  const elapsed = Date.now() - t0;
  if (elapsed < 40000) await sleep(40000 - elapsed);
  await ctx.close(); // flushes video
  console.log(name, 'recorded ~', Math.round((Date.now() - t0) / 1000), 's');
}

await record('en', BASE, async (p) => {
  await sleep(1500);
  await p.mouse.wheel(0, 500); await sleep(1200);
  await p.mouse.wheel(0, -500); await sleep(800);
  await p.locator('[data-testid="cta-demo"]').click();
  await sleep(1600); // landing preview reveal beat
  await p.evaluate(() => { window.location.hash = '#/workspace'; });
  await p.waitForSelector('.rf-review-actions, .rf-findings, .rf-banner-error', { timeout: 90000 });
  const approve = p.locator('.rf-review-actions .rf-btn--primary');
  if (await approve.count()) { await approve.click(); }
  await p.locator('.rf-findings').waitFor({ timeout: 90000 });
  await sleep(2000);
  await p.mouse.wheel(0, 600); await sleep(1500); await p.mouse.wheel(0, -600);
  await p.locator('[data-testid="view-evidence-btn"]').first().click();
  await sleep(2500);
  await p.keyboard.press('Escape'); await sleep(1200);
  await p.locator('[data-testid="export-prepare-btn"]').click();
  await sleep(3500);
  await p.keyboard.press('Escape'); await sleep(1500);
});

await record('ar', `${BASE}/ar/`, async (p) => {
  await sleep(1500);
  await p.mouse.wheel(0, 500); await sleep(1200);
  await p.mouse.wheel(0, -500); await sleep(800);
  await p.locator('[data-testid="upload-input"]').setInputFiles(CSV);
  await p.waitForSelector('.rf-review-actions, .rf-findings', { timeout: 90000 });
  await sleep(1500);
  const approve = p.locator('.rf-review-actions .rf-btn--primary');
  if (await approve.count()) { await approve.click(); }
  await p.locator('.rf-findings').waitFor({ timeout: 90000 });
  await sleep(2000);
  const ev = p.locator('[data-testid="view-evidence-btn"]').first();
  if (await ev.count()) { await ev.click(); await sleep(2500); await p.keyboard.press('Escape'); }
  await sleep(1500);
});

await browser.close();
console.log('DONE');
