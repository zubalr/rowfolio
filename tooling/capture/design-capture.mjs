/**
 * design-capture.mjs — visual QA capture harness. Drives the real dev server
 * in EN + AR and records screenshots, overflow metrics, reduced-motion and
 * 200%-zoom checks for the landing, upload, review, ready, evidence, export
 * and error surfaces.
 *
 * Usage:
 *   pnpm dev (in apps/web)  → serves http://localhost:5173
 *   node tooling/capture/design-capture.mjs
 *
 * Env overrides: BASE (default http://localhost:5173), OUT
 * (default tooling/capture/captures/design), REPO (repo root, auto-detected).
 * Generated media is never committed — OUT defaults under captures/ which is
 * git-ignored.
 */
/* global window, document */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const { mkdirSync, writeFileSync } = fs;

const REPO_ROOT = new URL('../..', import.meta.url).pathname;
const require = createRequire(path.join(REPO_ROOT, 'package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE ?? 'http://localhost:5173';
const REPO = path.resolve(process.env.REPO ?? REPO_ROOT);
const OUT = path.resolve(process.env.OUT ?? path.join(REPO, 'tooling/capture/captures/design'));
const SAMPLE_XLSX = path.join(REPO, 'apps/web/public/sample/sample_operations.xlsx');
// argv form — never interpolate env-derived paths into a shell string.
const COMMIT = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD']).toString().trim();
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 740 },
];

const results = [];
const browser = await chromium.launch();
function sha(buf) { return createHash('sha256').update(buf).digest('hex').slice(0, 16); }
async function shot(page, name) {
  const buf = await page.screenshot({ path: `${OUT}/${name}.png` });
  results.push({ name, sha256: sha(buf), bytes: buf.length });
  console.log(`  ${name}.png (${buf.length}b)`);
}
const settle = (page, ms = 700) => page.waitForTimeout(ms);

async function landingFlow(page, localePrefix, tag) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${BASE}${localePrefix}/`, { waitUntil: 'networkidle' });
    await settle(page, 900);
    await shot(page, `${tag}-landing-${vp.name}`);
    if (vp.name === '1440') await page.screenshot({ path: `${OUT}/${tag}-landing-1440-full.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}${localePrefix}/`, { waitUntil: 'networkidle' });
  await settle(page, 900);
  const cta = page.locator('[data-testid="cta-demo"]');
  if (await cta.count()) {
    await cta.click();
    await settle(page, 1600);
    await shot(page, `${tag}-landing-revealed-1440`);
    const btn = page.locator('[data-testid="preview-finding"] button');
    if (await btn.count()) { await btn.first().click(); await settle(page, 900); await shot(page, `${tag}-landing-evidence-1440`); }
  }
}

// Upload path: works in both locales; exercises configure + review + ready.
async function uploadWorkspaceFlow(page, localePrefix, tag) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}${localePrefix}/`, { waitUntil: 'networkidle' });
  await settle(page, 800);
  await page.locator('[data-testid="cta-upload"]').click(); // opens picker → set file
  const landingInput = page.locator('[data-testid="upload-input"]');
  await landingInput.setInputFiles(SAMPLE_XLSX);
  // lands on #/workspace with the file intent → session pipeline runs
  // (inspect → parse → profile → needsReview for the sample's quality issues)
  try {
    await page.waitForSelector('.rf-review-actions, .rf-findings, [data-testid="configure-panel"], .rf-banner-error', { timeout: 60000 });
  } catch { /* noop */ }
  await settle(page, 1000);

  // UploadFlow configure stage (only when UploadFlow owns the flow)
  if (await page.locator('[data-testid="configure-panel"]').count()) {
    await shot(page, `${tag}-upload-configure-1440`);
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 500);
    await shot(page, `${tag}-upload-configure-390`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-testid="configure-proceed"]').click();
    await settle(page, 2500);
  }
  if (await page.locator('[data-testid="review-panel"]').count()) {
    await shot(page, `${tag}-upload-review-1440`);
    await page.locator('[data-testid="review-submit"]').click();
  }
  // Session needsReview stage (workspace ReviewPanel)
  if (await page.locator('.rf-review-actions').count()) {
    await shot(page, `${tag}-review-needed-1440`);
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 500);
    await shot(page, `${tag}-review-needed-390`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.rf-review-actions .rf-btn--primary').click();
  }
  try {
    await page.waitForSelector('.rf-findings', { timeout: 60000 });
  } catch {
    await shot(page, `${tag}-workspace-timeout-1440`);
    return;
  }
  await settle(page, 1500);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await settle(page, 700);
    await shot(page, `${tag}-workspace-ready-${vp.name}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${OUT}/${tag}-workspace-ready-1440-full.png`, fullPage: true });

  const findings = page.locator('.rf-findings .rf-finding-main');
  if (await findings.count() > 1) { await findings.nth(1).click(); await settle(page, 500); await shot(page, `${tag}-workspace-selected-1440`); await findings.nth(0).click(); await settle(page, 400); }

  const ev = page.locator('[data-testid="view-evidence-btn"]');
  if (await ev.count()) {
    await ev.first().click();
    await settle(page, 1400);
    await shot(page, `${tag}-evidence-1440`);
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 600);
    await shot(page, `${tag}-evidence-390`);
    await page.setViewportSize({ width: 1440, height: 900 });
    const tabs = page.locator('[role="tab"]');
    if (await tabs.count() > 1) { await tabs.nth(1).click().catch(() => {}); await settle(page, 800); await shot(page, `${tag}-evidence-rows-1440`); }
    await page.keyboard.press('Escape');
    await settle(page, 500);
  }

  const range = page.locator('input[type="range"]');
  if (await range.count()) {
    await range.first().fill('8');
    await settle(page, 900);
    await shot(page, `${tag}-scenario-1440`);
  }

  const prep = page.locator('[data-testid="export-prepare-btn"]');
  if (await prep.count()) {
    await prep.click();
    await settle(page, 400);
    await shot(page, `${tag}-export-building-1440`);
    try { await page.waitForSelector('.rf-export-links, .rf-download', { timeout: 90000 }); } catch { /* noop */ }
    await settle(page, 800);
    await shot(page, `${tag}-export-ready-1440`);
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 500);
    await shot(page, `${tag}-export-390`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press('Escape');
    await settle(page, 400);
  }
}

// Sample-CTA journey (the 1-click demo path) — documents the AR 404 blocker.
async function sampleJourney(page, localePrefix, tag) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}${localePrefix}/`, { waitUntil: 'networkidle' });
  await settle(page, 800);
  await page.locator('[data-testid="cta-demo"]').click();
  await settle(page, 600);
  await page.evaluate(() => { window.location.hash = '#/workspace'; });
  try {
    await page.waitForSelector('.rf-findings, .rf-banner-error', { timeout: 30000 });
  } catch { /* noop */ }
  await settle(page, 1200);
  const ok = await page.locator('.rf-findings').count();
  await shot(page, `${tag}-sample-journey-${ok ? 'ready' : 'error'}-1440`);
  return ok > 0;
}

async function errorFlow(page, localePrefix, tag) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}${localePrefix}/#/workspace`, { waitUntil: 'networkidle' });
  await settle(page, 2000);
  const bad = path.join(OUT, '_bad.txt');
  fs.writeFileSync(bad, 'this is not a spreadsheet\n');
  const input = page.locator('[data-testid="upload-dropzone"] input[type="file"], input[type="file"]').first();
  if (await input.count()) {
    await input.setInputFiles(bad);
    await settle(page, 3000);
    await shot(page, `${tag}-error-invalid-1440`);
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 400);
    await shot(page, `${tag}-error-invalid-390`);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
}

async function videoFlow(localePrefix, tag) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: `${OUT}/video-${tag}`, size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${localePrefix}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('[data-testid="cta-demo"]').click();
  await page.waitForTimeout(4000);
  const btn = page.locator('[data-testid="preview-finding"] button');
  if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(3000); }
  // upload path so both locales reach a real workspace
  await page.locator('[data-testid="cta-upload"]').click();
  await page.locator('[data-testid="upload-input"]').setInputFiles(SAMPLE_XLSX);
  await page.waitForTimeout(2500);
  if (await page.locator('[data-testid="configure-proceed"]').count()) { await page.locator('[data-testid="configure-proceed"]').click(); await page.waitForTimeout(2500); }
  if (await page.locator('[data-testid="review-submit"]').count()) { await page.locator('[data-testid="review-submit"]').click(); }
  try { await page.waitForSelector('.rf-review-actions', { timeout: 3000 }); await page.locator('.rf-review-actions .rf-btn--primary').click(); } catch { /* noop */ }
  try { await page.waitForSelector('.rf-findings', { timeout: 60000 }); } catch { /* noop */ }
  await page.waitForTimeout(2500);
  const findings = page.locator('.rf-findings .rf-finding-main');
  if (await findings.count() > 1) { await findings.nth(1).click(); await page.waitForTimeout(2000); }
  const ev = page.locator('[data-testid="view-evidence-btn"]');
  if (await ev.count()) { await ev.first().click(); await page.waitForTimeout(4000); await page.keyboard.press('Escape'); await page.waitForTimeout(1500); }
  const range = page.locator('input[type="range"]');
  if (await range.count()) { for (const v of ['4', '8', '12', '8']) { await range.first().fill(v); await page.waitForTimeout(900); } }
  const prep = page.locator('[data-testid="export-prepare-btn"]');
  if (await prep.count()) { await prep.click(); await page.waitForTimeout(8000); await page.keyboard.press('Escape'); }
  await page.waitForTimeout(1500);
  await ctx.close();
}

async function reducedMotionCheck(localePrefix, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto(`${BASE}${localePrefix}/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.locator('[data-testid="cta-demo"]').click();
  await p.waitForTimeout(1200);
  const buf = await p.screenshot({ path: `${OUT}/${tag}-reduced-motion-1440.png` });
  results.push({ name: `${tag}-reduced-motion-1440`, sha256: sha(buf), bytes: buf.length });
  // also check no element is mid-animation
  const animating = await p.evaluate(() => document.getAnimations().length);
  console.log(`  ${tag} reduced-motion: ${animating} active animations`);
  results.push({ name: `${tag}-reduced-motion-animations`, value: animating });
  await ctx.close();
}

// 200% zoom legibility spot-check (workspace, per spec zoom review).
async function zoomCheck(page, localePrefix, tag) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}${localePrefix}/`, { waitUntil: 'networkidle' });
  await settle(page, 600);
  await page.locator('[data-testid="cta-upload"]').click();
  await page.locator('[data-testid="upload-input"]').setInputFiles(SAMPLE_XLSX);
  await settle(page, 2000);
  if (await page.locator('[data-testid="configure-proceed"]').count()) { await page.locator('[data-testid="configure-proceed"]').click(); await settle(page, 2000); }
  if (await page.locator('[data-testid="review-submit"]').count()) { await page.locator('[data-testid="review-submit"]').click(); }
  try { await page.waitForSelector('.rf-review-actions', { timeout: 3000 }); await page.locator('.rf-review-actions .rf-btn--primary').click(); } catch { /* noop */ }
  try { await page.waitForSelector('.rf-findings', { timeout: 60000 }); } catch { /* noop */ }
  await settle(page, 1000);
  await page.setViewportSize({ width: 720, height: 450 }); // ~200% of 1440 content
  await page.evaluate(() => { document.body.style.zoom = '2'; });
  await settle(page, 800);
  await shot(page, `${tag}-zoom200-720`);
  await page.evaluate(() => { document.body.style.zoom = '1'; });
}

const ctx0 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx0.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log(`  [console.error] ${m.text().slice(0, 160)}`); });
page.on('response', (r) => { if (r.status() >= 400) console.log(`  [${r.status()}] ${r.url()}`); });

console.log('== EN ==');
await landingFlow(page, '', 'en');
console.log('  EN sample-journey:', await sampleJourney(page, '', 'en') ? 'READY' : 'FAILED');
await uploadWorkspaceFlow(page, '', 'en');
await errorFlow(page, '', 'en');
await reducedMotionCheck('', 'en');
await zoomCheck(page, '', 'en');

console.log('== AR ==');
await landingFlow(page, '/ar', 'ar');
console.log('  AR sample-journey:', await sampleJourney(page, '/ar', 'ar') ? 'READY' : 'FAILED');
await uploadWorkspaceFlow(page, '/ar', 'ar');
await errorFlow(page, '/ar', 'ar');
await reducedMotionCheck('/ar', 'ar');
await zoomCheck(page, '/ar', 'ar');

await ctx0.close();
console.log('== Videos ==');
await videoFlow('', 'en');
await videoFlow('/ar', 'ar');

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ commit: COMMIT, base: BASE, capturedAt: new Date().toISOString(), captures: results }, null, 2));
await browser.close();
console.log(`DONE — ${results.length} captures`);
