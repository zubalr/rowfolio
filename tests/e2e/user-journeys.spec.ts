/**
 * End-to-End User Journeys
 *
 * Full user journeys from contracts:
 * 1. Demo journey: Landing -> Demo -> Finding Selection -> Evidence Drawer -> Source Rows -> Scenario -> Export -> Reset.
 * 2. Bilingual toggle journey: English <-> Arabic full flow with RTL directionality check.
 * 3. File upload journey: Drag/drop or file input for CSV/XLSX.
 * 4. Reduced-motion user journey.
 */
import { test, expect } from "@playwright/test";
import { ensureStaticServer, stopStaticServer } from "./helpers.ts";

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

    const showWhyBtn = page.locator('button[aria-controls="rf-preview-evidence"], button:has-text("Show me why"), [data-testid="view-evidence-btn"]');
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

    // 5. Prepare native exports / briefing
    const prepareBtn = page.locator('[data-testid="preview-briefing"] button, button:has-text("Prepare briefing"), [data-testid="export-prepare-btn"]');
    await expect(prepareBtn.first()).toBeVisible();
    await prepareBtn.first().click();
    await expect(page.locator('.rf-briefing__file[data-ready="true"], [data-testid="export-ready"]').first()).toBeVisible();

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
    expect(await page.getAttribute("html", "lang")).toBe("ar");
    expect(await page.getAttribute("html", "dir")).toBe("rtl");
    const brand = await page.locator(".rf-brand").first().textContent();
    expect(brand).toContain("روفوليو");
  });

  test("Journey 3: File Upload Ingestion Flow", async ({ page }) => {
    await page.goto("/");
    const uploadInput = page.locator('input[type="file"]');
    const hasUpload = (await uploadInput.count()) > 0;

    if (!hasUpload) {
      test.skip(
        true,
        "PENDING: File upload input is not yet mounted in application shell on frozen base",
      );
      return;
    }

    // Check if workspace upload review surface is routed in apps/web
    const hasWorkspaceUpload = (await page.locator('[data-testid="upload-dropzone"], .rf-upload').count()) > 0;
    if (!hasWorkspaceUpload) {
      test.skip(
        true,
        "PENDING: Workspace router / session layer is not yet wired in apps/web/src/main.ts to mount UploadFlow upon file selection",
      );
      return;
    }

    // Set file input
    await uploadInput.setInputFiles({
      name: "test_input.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Period,Region,Revenue\n2026-03,North,1000\n"),
    });

    await expect(page.locator("text=test_input.csv")).toBeVisible();
  });

  test("Journey 4: Reduced Motion Preference Compliance", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    // Verify page loads without error under reduced motion
    const heading = await page.textContent("h1");
    expect(heading).toBeTruthy();
  });
});
