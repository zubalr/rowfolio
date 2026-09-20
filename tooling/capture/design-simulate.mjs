/**
 * design-simulate.mjs — A/B harness: captures surfaces with and without a
 * stylesheet override applied via addStyleTag (useful for reviewing orphaned
 * or candidate CSS without touching the bundle), then drives the workspace
 * journey (CSV upload → review → ready → evidence → export) in both locales.
 *
 * Env overrides: BASE, OUT, REPO — see design-capture.mjs.
 * SKIP_A=1 skips the landing A/B section.
 */
/* global document, getComputedStyle */
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const REPO_ROOT = new URL('../..', import.meta.url).pathname;
const require = createRequire(`${REPO_ROOT}/package.json`);
const { chromium } = require('@playwright/test');

const REPO = path.resolve(process.env.REPO ?? REPO_ROOT);
const OUT = path.resolve(process.env.OUT ?? path.join(REPO, 'tooling/capture/captures/design'));
const BASE = process.env.BASE ?? 'http://localhost:5173';



const CSV = path.join(REPO, 'fixtures/sample/sample_operations.csv');
const landingCss = readFileSync(path.join(REPO, 'apps/web/src/landing/landing.css'), 'utf8');
const evidenceCss = readFileSync(path.join(REPO, 'apps/web/src/evidence/evidence.css'), 'utf8');
const results = {};
mkdirSync(OUT, { recursive: true });

async function shot(page, name, opts = {}) {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log('shot', name);
}
async function metrics(page) {
  return page.evaluate(() => ({
    clientW: document.documentElement.clientWidth,
    scrollW: document.documentElement.scrollWidth,
    fontsLoaded: [...document.fonts].map(f => `${f.family}/${f.weight}/${f.status}`),
    landingCssApplied: getComputedStyle(document.querySelector('.rf-hero__actions') || document.body).display,
  }));
}

const browser = await chromium.launch();

/* ---------- A: landing after-shots ---------- */
if (!process.env.SKIP_A) for (const loc of ['en', 'ar']) {
  const base = loc === 'ar' ? `${BASE}/ar/` : BASE;
  for (const vp of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.addStyleTag({ content: landingCss });
    await page.waitForTimeout(450);
    const m = await metrics(page);
    results[`${loc}-landing-after-${vp.width}`] = m;
    await shot(page, `${loc}-landing-after-${vp.width}`);
    await shot(page, `${loc}-landing-after-${vp.width}-full`, { fullPage: true });
    // revealed preview state
    const replay = page.locator('.rf-preview__head .rf-btn, [data-testid="preview-reveal-btn"], .rf-preview button').first();
    if (await replay.count()) { await replay.click().catch(() => {}); await page.waitForTimeout(900); }
    await shot(page, `${loc}-landing-after-revealed-${vp.width}`);
    await ctx.close();
  }
}

/* ---------- B: workspace CSV journey ---------- */
for (const loc of ['en', 'ar']) {
  const base = loc === 'ar' ? `${BASE}/ar/` : BASE;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log(`[${loc} console.error]`, m.text().slice(0, 160)); });
  try {
  await page.goto(base, { waitUntil: 'networkidle' });
  // open upload flow
  // cta-upload opens the OS picker; drive the hidden input directly
  await page.locator('[data-testid="upload-input"]').waitFor({ state: 'attached', timeout: 15000 });
  await page.locator('[data-testid="upload-input"]').setInputFiles(CSV);
  // workspace intent: ingest → normalize → needsReview (.rf-review-actions) or ready
  const stageSel = '.rf-review-actions, .rf-findings, .rf-banner-error, [data-testid="upload-error"], [data-testid="review-panel"]';
  await page.waitForSelector(stageSel, { timeout: 90000 });
  if (await page.locator('.rf-review-actions').count()) {
    await shot(page, `${loc}-upload-review-1440`);
    await page.locator('.rf-review-actions .rf-btn--primary').click();
  }
  if (await page.locator('[data-testid="upload-error"], .rf-banner-error').first().count()) {
    await shot(page, `${loc}-upload-error-1440`);
    results[`${loc}-upload`] = 'ERROR';
    await ctx.close();
    continue;
  }
  await page.locator('.rf-findings, [data-testid^="finding-"]').first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(1200);
  await shot(page, `${loc}-ready-1440`);
  await shot(page, `${loc}-ready-1440-full`, { fullPage: true });
  results[`${loc}-ready`] = await metrics(page);

  // evidence — before (orphaned css) then after (injected)
  const evBtn = page.locator('[data-testid="view-evidence-btn"]').first();
  await evBtn.click();
  await page.waitForTimeout(900);
  await shot(page, `${loc}-evidence-before-1440`);
  await page.addStyleTag({ content: evidenceCss });
  await page.waitForTimeout(450);
  await shot(page, `${loc}-evidence-after-1440`);
  await shot(page, `${loc}-evidence-after-1440-full`, { fullPage: true });
  // close evidence (escape or close btn)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const closeBtn = page.locator('.rf-evidence [aria-label], .rf-dialog__close, [data-testid="evidence-close"]').first();
  if (await closeBtn.count()) await closeBtn.click().catch(() => {});
  await page.waitForTimeout(400);

  // export dialog
  const expBtn = page.locator('[data-testid="export-prepare-btn"]');
  if (await expBtn.count()) {
    await expBtn.click();
    await page.waitForTimeout(2500);
    await shot(page, `${loc}-export-dialog-1440`);
    await page.keyboard.press('Escape');
  }

  // mobile ready + evidence
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await shot(page, `${loc}-ready-390`);
  results[`${loc}-ready-390`] = await metrics(page);
  const evBtn2 = page.locator('[data-testid="view-evidence-btn"]').first();
  if (await evBtn2.count()) {
    await evBtn2.click();
    await page.waitForTimeout(700);
    await shot(page, `${loc}-evidence-after-390`);
  }
  } catch (e) {
    console.log(`[${loc} workspace FAILED]`, String(e).split('\n')[0]);
    try { await shot(page, `${loc}-failed-state-1440`); } catch { /* noop */ }
    results[`${loc}-workspace`] = 'FAILED: ' + String(e).split('\n')[0];
  }
  await ctx.close();
}

/* ---------- C: fonts ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`);
  });
  const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  results.fonts = { faces: fonts, bodyFont };
  await ctx.close();
}

await browser.close();
writeFileSync(`${OUT}/simulate-results.json`, JSON.stringify(results, null, 2));
console.log('DONE');
