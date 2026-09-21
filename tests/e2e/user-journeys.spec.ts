/**
 * End-to-End User Journeys
 *
 * Full user journeys from contracts:
 * 1. Demo journey: Landing -> Demo -> Finding Selection -> Evidence Drawer -> Source Rows -> Scenario -> Export -> Reset.
 * 2. Bilingual toggle journey: English <-> Arabic full flow with RTL directionality check.
 * 3. File upload journey: Drag/drop or file input for CSV/XLSX.
 * 4. Reduced-motion user journey.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { ensureStaticServer, stopStaticServer } from "./helpers.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.beforeAll(async () => {
  await ensureStaticServer(4173);
});

test.afterAll(() => {
  stopStaticServer();
});

test.describe("Full User Journeys", () => {
  test("Journey 1: Landing -> Demo -> Finding -> Evidence -> Scenario -> Export -> Clear", async ({ page }) => {
    await page.goto("/");

    // 1. Verify landing page brand & headline
    const brand = await page.textContent(".rf-brand");
    expect(brand).toContain("Rowfolio");
    const heading = await page.textContent("h1");
    expect(heading).toBeTruthy();

    // 2. Click demo CTA button
    const demoCta = page.locator('[data-testid="cta-demo"], [data-testid="open-demo-cta"]');
    await expect(demoCta.first()).toBeVisible();
    await demoCta.first().click();

    // 3. Inspect Finding and open Evidence Drawer
    const finding = page.locator('[data-testid="preview-finding"], [data-testid="finding-north"]');
    await expect(finding.first()).toBeVisible();

    const showWhyBtn = page.locator('button[aria-controls="rf-preview-evidence"], button:has-text("View calculation"), [data-testid="view-evidence-btn"]');
    await expect(showWhyBtn.first()).toBeVisible();
    await showWhyBtn.first().click();

    const evidence = page.locator('[data-testid="preview-evidence"], #rf-preview-evidence');
    await expect(evidence.first()).toBeVisible();
    await expect(evidence.locator("text=Operations!").first()).toBeVisible();

    // 4. Apply scenario calculation (+8% cost factor)
    const scenarioRange = page.locator('[data-testid="scenario-range"], #rf-cost-range, [data-testid="scenario-cost-input"]');
    await expect(scenarioRange.first()).toBeVisible();
    await scenarioRange.first().fill("8");
    await expect(page.locator(".rf-scenario__value, [data-testid='scenario-value']").first()).toBeVisible();

    // 5. Prepare the briefing specimen: the six slide outlines and the
    // workbook summary flip to data-ready (the demo path previews
    // readiness here; real downloads happen in the workspace flow and
    // are covered by Journey 5).
    const prepareBtn = page.locator('[data-testid="preview-briefing"] button, button:has-text("Create report"), [data-testid="export-prepare-btn"]');
    await expect(prepareBtn.first()).toBeVisible();
    await prepareBtn.first().click();
    const readySlides = page.locator('.rf-briefing__slide[data-ready="true"]');
    await expect(readySlides.first()).toBeVisible({ timeout: 30_000 });
    expect(await readySlides.count()).toBe(6);
    await expect(page.locator('.rf-briefing__workbook[data-ready="true"]')).toBeVisible({ timeout: 30_000 });

    // 6. Reset / clear demo session
    const resetBtn = page.locator('button:has-text("Replay demo"), button:has-text("Replay"), [data-testid="clear-session-btn"]');
    await expect(resetBtn.first()).toBeVisible();
    await resetBtn.first().click();

    // Verify session reset: evidence is closed
    await expect(evidence.first()).not.toBeVisible();
  });

  test("Journey 2: Bilingual Toggle (English <-> Arabic)", async ({ page }) => {
    await page.goto("/");
    expect(await page.getAttribute("html", "lang")).toBe("en");

    // Check for language switcher
    const langToggle = page.locator('.rf-lang, a:has-text("العربية"), button:has-text("العربية")');
    const hasToggle = (await langToggle.count()) > 0;

    if (!hasToggle) {
      // Direct navigation to Arabic entry
      await page.goto("/ar/");
      expect(await page.getAttribute("html", "lang")).toBe("ar");
      expect(await page.getAttribute("html", "dir")).toBe("rtl");
      const brand = await page.locator(".rf-brand").first().textContent();
      expect(brand).toContain("روفوليو");
      return;
    }

    await langToggle.first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const brand = await page.locator(".rf-brand").first().textContent();
    expect(brand).toContain("روفوليو");
  });

  test("Journey 3: File Upload Ingestion Flow", async ({ page }) => {
    await page.goto("/");
    const uploadInput = page.locator('input[type="file"]').first();
    await expect(uploadInput).toBeAttached({ timeout: 10_000 });

    const sampleCsvPath = path.resolve(repoRoot, "fixtures/sample/sample_operations.csv");
    await uploadInput.setInputFiles(sampleCsvPath);

    // Transitions to workspace
    await expect(page).toHaveURL(/#\/workspace/, { timeout: 15_000 });

    // ReviewPanel mounts with proposed quality issues review
    const applyBtn = page.locator('button:has-text("Apply approved changes")');
    await expect(applyBtn).toBeVisible({ timeout: 15_000 });
    await applyBtn.click();

    // Verification of ready workspace
    await expect(page.locator("text=Example analysis")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("text=2400 retained")).toBeVisible();

    // Clear session resets back to landing page
    const clearBtn = page.locator('[data-testid="clear-session-btn"]');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await expect(page.locator("h1")).toBeVisible();
  });

  test("Journey 4: Reduced Motion Preference Compliance", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    // Verify page loads without error under reduced motion
    const heading = await page.textContent("h1");
    expect(heading).toBeTruthy();
  });

  test("Journey 5: Export XLSX/PPTX preparation, Blob URL lifecycle, and session revocation", async ({ page }) => {
    await page.goto("/");

    // Instrument URL.createObjectURL and URL.revokeObjectURL
    await page.evaluate(() => {
      const g = window as unknown as {
        __createdUrls: string[];
        __revokedUrls: string[];
      };
      g.__createdUrls = [];
      g.__revokedUrls = [];
      const origCreate = URL.createObjectURL.bind(URL);
      const origRevoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob: Blob | MediaSource) => {
        const url = origCreate(blob);
        g.__createdUrls.push(url);
        return url;
      };
      URL.revokeObjectURL = (url: string) => {
        g.__revokedUrls.push(url);
        origRevoke(url);
      };
    });

    const uploadInput = page.locator('input[type="file"]').first();
    await expect(uploadInput).toBeAttached({ timeout: 10_000 });

    const sampleCsvPath = path.resolve(repoRoot, "fixtures/sample/sample_operations.csv");
    await uploadInput.setInputFiles(sampleCsvPath);

    // Transitions to workspace
    await expect(page).toHaveURL(/#\/workspace/, { timeout: 15_000 });

    const applyBtn = page.locator('button:has-text("Apply approved changes")');
    await expect(applyBtn).toBeVisible({ timeout: 15_000 });
    await applyBtn.click();

    await expect(page.locator("text=Example analysis")).toBeVisible({ timeout: 15_000 });

    // Open export and prepare briefing
    const prepareBtn = page.locator('[data-testid="export-prepare-btn"]');
    await expect(prepareBtn).toBeVisible();
    await prepareBtn.click();

    // Verify export downloads appear
    const downloadLinks = page.locator(".rf-export-links a.rf-download");
    await expect(downloadLinks.first()).toBeVisible({ timeout: 25_000 });

    const hrefs = await downloadLinks.evaluateAll((links) =>
      links.map((el) => (el as HTMLAnchorElement).href)
    );
    expect(hrefs.length).toBeGreaterThanOrEqual(1);
    for (const href of hrefs) {
      expect(href.startsWith("blob:")).toBe(true);
    }

    // Inspect actual downloaded file via Playwright download manager
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      downloadLinks.first().click(),
    ]);
    const downloadStream = await download.createReadStream();
    if (downloadStream) {
      const chunks: Buffer[] = [];
      for await (const chunk of downloadStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const downloadedBuffer = Buffer.concat(chunks);
      expect(downloadedBuffer.length).toBeGreaterThan(100);
      expect(Array.from(downloadedBuffer.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04 zip header
    }

    // Close export dialog
    const closeBtn = page.locator("dialog[open] .rf-dialog__close");
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);

    // Clear session
    const clearBtn = page.locator('[data-testid="clear-session-btn"]');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    // Verify session clear navigated back to landing
    await expect(page.locator("h1")).toBeVisible();

    // Verify all created Blob URLs were revoked
    const { created, revoked } = await page.evaluate(() => {
      const g = window as unknown as {
        __createdUrls: string[];
        __revokedUrls: string[];
      };
      return { created: g.__createdUrls, revoked: g.__revokedUrls };
    });

    expect(created.length).toBeGreaterThan(0);
    for (const url of created) {
      expect(revoked).toContain(url);
    }
  });

  test("Journey 6: Ambiguous-delimiter CSV recovers via the workspace delimiter picker", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error);
    });

    // Deterministic ambiguous-delimiter fixture (os tmpdir, never
    // committed): comma and semicolon both parse every record at uniform
    // width, so inspection reports AMBIGUOUS_INPUT/csv.ambiguous-delimiter.
    // The workspace UploadFlow path must offer the delimiter picker (the
    // landing adoptFile path has no recovery action — reported to Cloud).
    const { tmpdir } = await import("node:os");
    const { writeFileSync, unlinkSync } = await import("node:fs");
    // Unique per run: parallel repeats must not share one tmp path.
    const ambiguousPath = path.join(
      tmpdir(),
      `rowfolio-ambiguous-delim-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.csv`,
    );
    writeFileSync(
      ambiguousPath,
      ["id;date,region", "R-1;2026-06-01,North", "R-2;2026-06-02,South"].join("\n"),
    );

    try {
      // Enter the workspace idle surface directly so the file reaches the
      // UploadFlow dropzone (not the landing adoptFile path).
      await page.goto("/#/workspace");
      const dropInput = page.locator('[data-testid="upload-flow"] input[type="file"]');
      await expect(dropInput).toBeAttached({ timeout: 10_000 });
      await dropInput.setInputFiles(ambiguousPath);

      // The delimiter picker offers comma, tab, and semicolon plus cancel.
      const picker = page.locator('[data-testid="delimiter-picker"]');
      await expect(picker).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="delimiter-,"]')).toBeVisible();
      await expect(page.locator('[data-testid="delimiter-;"]')).toBeVisible();

      // Choosing semicolon parses the file and advances into the normal
      // review flow (here: header-row/column confirmation for the
      // two-column split — proof the flow left the dead-end behind).
      await page.locator('[data-testid="delimiter-;"]').click();
      const applyBtn = page.locator('button:has-text("Apply approved changes")');
      await expect(applyBtn).toBeVisible({ timeout: 30_000 });
      await applyBtn.click();
      await expect(page.locator("text=Confirm the table and header row").first()).toBeVisible({ timeout: 15_000 });

      // Clean teardown with no retained workers.
      const clearBtn = page.locator('[data-testid="clear-session-btn"]');
      await expect(clearBtn).toBeVisible();
      await clearBtn.click();
      await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });
      await expect
        .poll(() => page.workers().length, { timeout: 10_000 })
        .toBe(0);

      // No uncaught exceptions anywhere in the recover path.
      expect(pageErrors).toEqual([]);
    } finally {
      unlinkSync(ambiguousPath);
    }
  });
});
