/**
 * Scripted capture journeys for the release-candidate capture matrix.
 *
 * A journey drives a real Chromium session through a defined set of product
 * steps and saves a PNG plus a provenance metadata record per step. Steps
 * wait on the application's stable data-testids with explicit timeouts; a
 * step whose control never appears records an explicit UNAVAILABLE marker
 * instead of failing silently — unavailable cases are evidence too.
 *
 * Every input stays explicit: the caller provides --url (base of the served
 * candidate), --commit, --out, viewport and locale. Nothing is guessed and
 * no server is started here.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';

export type Locale = 'en' | 'ar';

export interface JourneyOptions {
  baseUrl: string;
  commit: string;
  outDir: string;
  locale: Locale;
  width: number;
  height: number;
  journey: string;
  reducedMotion?: boolean;
  keyboardProbe?: boolean;
  uploadFile?: string;
  timeoutMs?: number;
}

interface StepResult {
  name: string;
  ok: boolean;
  file?: string;
  unavailableReason?: string;
  focus?: string;
  notes?: string[];
}

const STEP_TIMEOUT_DEFAULT = 15000;

function entryUrl(baseUrl: string, locale: Locale, hash?: string): string {
  const path = locale === 'ar' ? '/ar/' : '/';
  const clean = baseUrl.replace(/\/+$/, '');
  return `${clean}${path}${hash ?? ''}`;
}

async function newContext(browser: Browser, options: JourneyOptions): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
    reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference',
  });
}

function describeFocus(page: Page): string {
  const el = page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return 'none';
    const label = active.getAttribute('aria-label') ?? active.textContent?.trim().slice(0, 40) ?? '';
    return `${active.tagName.toLowerCase()}${active.dataset.testid ? `[${active.dataset.testid}]` : ''}:${label}`;
  });
  return el;
}

async function waitTestId(page: Page, testId: string, timeoutMs: number): Promise<void> {
  await page.getByTestId(testId).waitFor({ state: 'visible', timeout: timeoutMs });
}

async function shoot(page: Page, options: JourneyOptions, step: StepResult): Promise<StepResult> {
  const base = `${options.locale}-${options.journey}-${options.width}x${options.height}-${step.name}`;
  const pngPath = resolve(options.outDir, `${base}.png`);
  const buffer = await page.screenshot({ path: pngPath, fullPage: false });
  const metadata = {
    journey: options.journey,
    step: step.name,
    locale: options.locale,
    url: page.url(),
    hash: await page.evaluate(() => window.location.hash),
    commit: options.commit,
    capturedAt: new Date().toISOString(),
    viewport: { width: options.width, height: options.height },
    reducedMotion: options.reducedMotion === true,
    keyboardProbe: options.keyboardProbe === true,
    uploadFile: options.uploadFile ? resolve(options.uploadFile) : undefined,
    focus: step.focus,
    notes: step.notes ?? [],
    image: {
      path: pngPath,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      bytes: buffer.length,
    },
  };
  writeFileSync(resolve(options.outDir, `${base}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`);
  return { ...step, file: pngPath };
}

async function shootUnavailable(
  page: Page,
  options: JourneyOptions,
  stepName: string,
  reason: string,
): Promise<StepResult> {
  const base = `${options.locale}-${options.journey}-${options.width}x${options.height}-${stepName}`;
  const marker = resolve(options.outDir, `${base}-UNAVAILABLE.json`);
  // Preserve the exact on-screen state at failure: a stuck flow is only
  // actionable for review when the pixels accompany the reason.
  let statePng: string | undefined;
  try {
    statePng = resolve(options.outDir, `${base}-STATE.png`);
    await page.screenshot({ path: statePng, fullPage: false });
  } catch {
    statePng = undefined;
  }
  writeFileSync(
    marker,
    `${JSON.stringify(
      {
        journey: options.journey,
        step: stepName,
        locale: options.locale,
        url: page.url(),
        commit: options.commit,
        capturedAt: new Date().toISOString(),
        unavailableReason: reason,
        stateScreenshot: statePng,
      },
      null,
      2,
    )}\n`,
  );
  return { name: stepName, ok: false, unavailableReason: reason };
}

/** Run one step body; on timeout record an explicit UNAVAILABLE marker. */
async function step(
  page: Page,
  options: JourneyOptions,
  name: string,
  timeoutMs: number,
  body?: () => Promise<{ notes?: string[] } | void>,
): Promise<StepResult> {
  try {
    const extra = body ? await body() : undefined;
    const focus = options.keyboardProbe ? await describeFocus(page) : undefined;
    return await shoot(page, options, { name, ok: true, focus, notes: extra?.notes });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message.split('\n')[0]}` : String(error);
    return shootUnavailable(page, options, name, reason);
  }
}

/** The session-replace confirmation overlays the flow whenever a file
 * intent meets an active session; dismiss it before interacting. */
async function dismissReplaceDialog(page: Page, timeoutMs: number): Promise<string | undefined> {
  const confirm = page.getByTestId('confirm-replace-btn');
  try {
    await confirm.waitFor({ state: 'visible', timeout: 1500 });
    await confirm.click({ timeout: timeoutMs });
    return 'dismissed session-replace dialog';
  } catch {
    return undefined;
  }
}

export async function runJourney(browser: Browser, options: JourneyOptions): Promise<StepResult[]> {
  const timeout = options.timeoutMs ?? STEP_TIMEOUT_DEFAULT;
  mkdirSync(options.outDir, { recursive: true });
  const context = await newContext(browser, options);
  const page = await context.newPage();
  const results: StepResult[] = [];

  const landingSteps = async (): Promise<void> => {
    await page.goto(entryUrl(options.baseUrl, options.locale), { waitUntil: 'networkidle', timeout });
    results.push(await step(page, options, '01-hero', timeout));
    results.push(
      await step(page, options, '02-preview', timeout, async () => {
        await page.getByTestId('cta-demo').click({ timeout });
        await waitTestId(page, 'preview-finding', timeout);
      }),
    );
    results.push(
      await step(page, options, '03-evidence', timeout, async () => {
        await page.locator('[aria-controls="rf-preview-evidence"]').click({ timeout });
        await waitTestId(page, 'preview-evidence', timeout);
      }),
    );
    results.push(
      await step(page, options, '04-scenario', timeout, async () => {
        const slider = page.getByTestId('scenario-range');
        await slider.waitFor({ state: 'visible', timeout });
        // React controlled inputs ignore direct value assignment; go
        // through the native value setter, then fire the events React
        // listens for.
        await slider.evaluate((el) => {
          const input = el as HTMLInputElement;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, '8');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForTimeout(600);
      }),
    );
    results.push(
      await step(page, options, '05-briefing', timeout, async () => {
        await page.getByRole('button', { name: /Prepare briefing|جهّز الإحاطة/ }).click({ timeout });
        await waitTestId(page, 'preview-briefing', timeout);
        await page.waitForTimeout(600);
      }),
    );
  };

  const guideSteps = async (): Promise<void> => {
    await page.goto(entryUrl(options.baseUrl, options.locale), { waitUntil: 'networkidle', timeout });
    results.push(
      await step(page, options, '01-guide-start', timeout, async () => {
        await page.getByTestId('cta-guide').click({ timeout });
        await waitTestId(page, 'guide-bar', timeout);
        await page.waitForTimeout(800);
      }),
    );
    results.push(
      await step(page, options, '02-guide-next', timeout, async () => {
        // The guide's forward control is captioned with the next step's
        // name (GuideBar), not a literal "Next"; it is the third button
        // after Back and Pause/Resume.
        await page.getByTestId('guide-bar').getByRole('button').nth(2).click({ timeout });
        await page.waitForTimeout(1500);
      }),
    );
  };

  const workspaceSampleSteps = async (): Promise<void> => {
    // On the composed app the workspace idle state mounts the staged
    // upload flow; this journey walks the full review sequence with the
    // shipped sample workbook.
    if (!options.uploadFile) throw new Error('workspace journey requires --upload-file');
    await page.goto(entryUrl(options.baseUrl, options.locale, '#/workspace'), {
      waitUntil: 'networkidle',
      timeout,
    });
    results.push(await step(page, options, '01-workspace-entry', timeout, async () => {
      await waitTestId(page, 'upload-dropzone', timeout);
    }));
    results.push(
      await step(page, options, '02-configure', timeout, async () => {
        await page
          .locator('[data-testid="upload-dropzone"] input[type="file"]')
          .first()
          .setInputFiles(resolve(options.uploadFile!), { timeout });
        await dismissReplaceDialog(page, timeout);
        await waitTestId(page, 'configure-panel', timeout);
        await page.waitForTimeout(400);
      }),
    );
    results.push(
      await step(page, options, '03-review', timeout, async () => {
        await page.getByTestId('configure-proceed').click({ timeout });
        await waitTestId(page, 'review-panel', timeout);
        await page.waitForTimeout(500);
      }),
    );
    results.push(
      await step(page, options, '04-loaded', timeout, async () => {
        await page.getByTestId('review-submit').click({ timeout });
        await waitTestId(page, 'view-evidence-btn', timeout);
        await page.waitForTimeout(1200);
      }),
    );
    results.push(
      await step(page, options, '05-evidence', timeout, async () => {
        await page.getByTestId('view-evidence-btn').click({ timeout });
        await waitTestId(page, 'evidence-panel', timeout);
        await page.waitForTimeout(500);
      }),
    );
    results.push(
      await step(page, options, '06-scenario', timeout, async () => {
        await page.keyboard.press('Escape');
        const input = page.getByTestId('scenario-cost-input');
        await input.waitFor({ state: 'visible', timeout });
        await input.fill('8');
        await input.dispatchEvent('input');
        await page.waitForTimeout(600);
      }),
    );
    results.push(
      await step(page, options, '07-export', timeout, async () => {
        await page.getByTestId('export-prepare-btn').click({ timeout });
        await page.waitForTimeout(1500);
      }),
    );
  };

  const uploadSteps = async (): Promise<void> => {
    if (!options.uploadFile) throw new Error('upload journey requires --upload-file');
    // The landing CTA opens the real file chooser; the hidden input lives
    // on the landing page and hands the chosen file to the workspace
    // session as an in-memory intent, which the workspace then analyzes.
    await page.goto(entryUrl(options.baseUrl, options.locale), { waitUntil: 'networkidle', timeout });
    results.push(await step(page, options, '01-landing', timeout));
    results.push(
      await step(page, options, '02-attached', timeout, async () => {
        await page.getByTestId('upload-input').setInputFiles(resolve(options.uploadFile!), { timeout });
        await page.waitForURL(/#\/workspace/, { timeout });
      }),
    );
    results.push(
      await step(page, options, '03-loaded', timeout, async () => {
        await dismissReplaceDialog(page, timeout);
        await waitTestId(page, 'view-evidence-btn', timeout);
        await page.waitForTimeout(900);
      }),
    );
    results.push(
      await step(page, options, '04-evidence', timeout, async () => {
        await page.getByTestId('view-evidence-btn').click({ timeout });
        await waitTestId(page, 'evidence-panel', timeout);
        await page.waitForTimeout(500);
      }),
    );
    results.push(
      await step(page, options, '05-scenario', timeout, async () => {
        await page.keyboard.press('Escape');
        const input = page.getByTestId('scenario-cost-input');
        await input.waitFor({ state: 'visible', timeout });
        await input.fill('8');
        await input.dispatchEvent('input');
        await page.waitForTimeout(600);
      }),
    );
    results.push(
      await step(page, options, '06-export', timeout, async () => {
        await page.getByTestId('export-prepare-btn').click({ timeout });
        await page.waitForTimeout(1500);
      }),
    );
  };

  const journeys: Record<string, () => Promise<void>> = {
    landing: landingSteps,
    guide: guideSteps,
    'workspace-sample': workspaceSampleSteps,
    upload: uploadSteps,
  };
  const run = journeys[options.journey];
  if (!run) {
    await context.close();
    throw new Error(`unknown journey "${options.journey}" (known: ${Object.keys(journeys).join(', ')})`);
  }
  await run();
  await context.close();
  return results;
}
