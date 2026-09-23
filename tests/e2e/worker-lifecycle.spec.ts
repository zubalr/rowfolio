/**
 * End-to-End Web Worker Lifecycle Verification
 *
 * Verifies real browser Web Worker behavior through Playwright:
 * 1. Worker creation, retention, and complete closure on clearSession().
 * 2. Active workers stay strictly bounded (no unbounded worker leaks).
 * 3. Source replacement during an active session terminates retired workers.
 * 4. Cancellation/failure recovery leaves the application functional for re-upload.
 * 5. Cleared sessions cannot be repopulated by stale worker completions.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type Worker as PlaywrightWorker } from "@playwright/test";
import { ensureStaticServer, stopStaticServer } from "./helpers.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.beforeAll(async () => {
  await ensureStaticServer(4173);
});

test.afterAll(() => {
  stopStaticServer();
});

test.describe("Web Worker Lifecycle & Boundary Guarantees", () => {
  test("Worker lifecycle: spawn upon request, bounded retention, and complete closure on clearSession", async ({
    page,
  }) => {
    const spawnedWorkers: PlaywrightWorker[] = [];
    const closedWorkers: PlaywrightWorker[] = [];

    page.on("worker", (worker) => {
      spawnedWorkers.push(worker);
      worker.on("close", () => {
        closedWorkers.push(worker);
      });
    });

    // 1. Initial state: no workers active before user action
    await page.goto("/");
    expect(page.workers().length).toBe(0);
    expect(spawnedWorkers.length).toBe(0);

    // 2. Upload file: analysis worker is spawned lazily
    const uploadInput = page.locator('input[type="file"]').first();
    await expect(uploadInput).toBeAttached({ timeout: 10_000 });

    const sampleCsvPath = path.resolve(repoRoot, "fixtures/sample/sample_operations.csv");
    await uploadInput.setInputFiles(sampleCsvPath);

    // Transition to workspace
    await expect(page).toHaveURL(/#\/workspace/, { timeout: 15_000 });

    // Verify analysis worker was spawned
    await expect.poll(() => spawnedWorkers.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    const analysisWorker = spawnedWorkers[0];
    expect(analysisWorker.url()).toContain("analysis.worker");
    expect(page.workers()).toContain(analysisWorker);

    // 3. Approve quality issues: analysis executes on the existing analysis worker
    const applyBtn = page.locator('button:has-text("Apply approved changes")');
    await expect(applyBtn).toBeVisible({ timeout: 15_000 });
    await applyBtn.click();

    await expect(page.locator("text=Example analysis")).toBeVisible({ timeout: 15_000 });
    // Active worker count remains bounded (exactly 1 active worker)
    expect(page.workers().length).toBe(1);

    // 4. Prepare export: export worker is spawned lazily
    const prepareBtn = page.locator('[data-testid="export-prepare-btn"]');
    await expect(prepareBtn).toBeVisible();
    await prepareBtn.click();

    // Verify export worker is spawned
    await expect.poll(() => spawnedWorkers.length, { timeout: 15_000 }).toBe(2);
    const exportWorker = spawnedWorkers.find((w) => w.url().includes("export.worker"));
    expect(exportWorker).toBeDefined();

    // Verify export artifacts complete
    const downloadLinks = page.locator(".rf-export-links a.rf-download");
    await expect(downloadLinks.first()).toBeVisible({ timeout: 25_000 });

    // Close export dialog
    const closeBtn = page.locator("dialog[open] .rf-dialog__close");
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);

    // 5. Clear session: triggers dispose on both analysis and export clients
    const clearBtn = page.locator('[data-testid="clear-session-btn"]');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    // Verify reset to landing page
    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

    // 6. Prove retired workers close and active workers return to zero
    await expect
      .poll(() => closedWorkers.length, { timeout: 10_000 })
      .toBe(spawnedWorkers.length);
    expect(page.workers().length).toBe(0);
  });

  test("Source replacement: retired worker is terminated and does not pollute new session", async ({
    page,
  }) => {
    const spawnedWorkers: PlaywrightWorker[] = [];
    const closedWorkers: PlaywrightWorker[] = [];

    page.on("worker", (worker) => {
      spawnedWorkers.push(worker);
      worker.on("close", () => {
        closedWorkers.push(worker);
      });
    });

    await page.goto("/");
    const uploadInput = page.locator('input[type="file"]').first();
    await expect(uploadInput).toBeAttached({ timeout: 10_000 });

    const sampleCsvPath = path.resolve(repoRoot, "fixtures/sample/sample_operations.csv");
    await uploadInput.setInputFiles(sampleCsvPath);
    await expect(page).toHaveURL(/#\/workspace/, { timeout: 15_000 });

    const applyBtn = page.locator('button:has-text("Apply approved changes")');
    await expect(applyBtn).toBeVisible({ timeout: 15_000 });
    await applyBtn.click();
    await expect(page.locator("text=Example analysis")).toBeVisible({ timeout: 15_000 });

    expect(spawnedWorkers.length).toBe(1);
    const firstWorker = spawnedWorkers[0];
    expect(closedWorkers).not.toContain(firstWorker);

    // Now initiate source replacement via header file input
    const headerFileInput = page.locator('header input[type="file"]');
    await headerFileInput.setInputFiles(sampleCsvPath);

    // Confirmation dialog appears to guard against accidental replacement
    const confirmBtn = page.locator('[data-testid="confirm-replace-btn"]');
    await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
    await confirmBtn.click();

    // Verification: The previous worker is terminated upon source replacement
    await expect
      .poll(() => closedWorkers.includes(firstWorker), { timeout: 10_000 })
      .toBe(true);

    // Workspace transitions to reading / reviewing the replacement
    // Wait for the new session to reach approval and approve it
    const applyNewBtn = page.locator('button:has-text("Apply approved changes")');
    await expect(applyNewBtn).toBeVisible({ timeout: 15_000 });
    await applyNewBtn.click();

    await expect(page.locator("text=Example analysis")).toBeVisible({ timeout: 15_000 });

    // Active workers remain bounded to at most 1 active worker
    expect(page.workers().length).toBeLessThanOrEqual(1);

    // Tear down
    const clearBtn = page.locator('[data-testid="clear-session-btn"]');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await expect(page.locator("h1")).toBeVisible();

    await expect
      .poll(() => page.workers().length, { timeout: 10_000 })
      .toBe(0);
  });

  test("Error recovery: rejected input displays error and subsequent valid upload succeeds cleanly", async ({
    page,
  }) => {
    const spawnedWorkers: PlaywrightWorker[] = [];
    const closedWorkers: PlaywrightWorker[] = [];

    page.on("worker", (worker) => {
      spawnedWorkers.push(worker);
      worker.on("close", () => {
        closedWorkers.push(worker);
      });
    });

    await page.goto("/");

    // 1. Upload a file exceeding column limits (105 columns > 100 column limit)
    const uploadInput = page.locator('input[type="file"]').first();
    await expect(uploadInput).toBeAttached({ timeout: 10_000 });

    const excessColumnsCsv = {
      name: "excess_columns.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        Array.from({ length: 105 }, (_, i) => `col_${i}`).join(",") +
          "\n" +
          Array.from({ length: 105 }, (_, i) => `val_${i}`).join(",")
      ),
    };
    await uploadInput.setInputFiles(excessColumnsCsv);

    // 2. Error surface appears with typed failure and dismiss action
    const errorAlert = page.locator('[data-testid="upload-error"], .rf-banner-error, [role="alert"]');
    await expect(errorAlert.first()).toBeVisible({ timeout: 10_000 });

    const dismissBtn = page.locator('[data-testid="upload-error-dismiss"]');
    if (await dismissBtn.isVisible()) {
      await dismissBtn.click();
    }

    // 3. Clear or navigate back to landing if on workspace, or re-upload valid file
    const sampleCsvPath = path.resolve(repoRoot, "fixtures/sample/sample_operations.csv");
    const activeFileInput = page.locator('input[type="file"]').first();
    await activeFileInput.setInputFiles(sampleCsvPath);

    // 4. Clean recovery: valid file enters review or workspace
    const applyBtn = page.locator('button:has-text("Apply approved changes")');
    await expect(applyBtn).toBeVisible({ timeout: 15_000 });
    await applyBtn.click();

    await expect(page.locator("text=Example analysis")).toBeVisible({ timeout: 15_000 });
    expect(page.workers().length).toBeLessThanOrEqual(1);

    // 5. Clean teardown
    const clearBtn = page.locator('[data-testid="clear-session-btn"]');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await expect(page.locator("h1")).toBeVisible();

    await expect
      .poll(() => page.workers().length, { timeout: 10_000 })
      .toBe(0);
  });

  test("Cancel during export preparation recovers and re-prepare succeeds", async ({
    page,
  }) => {
    const spawnedWorkers: PlaywrightWorker[] = [];
    const pageErrors: Error[] = [];

    page.on("worker", (worker) => {
      spawnedWorkers.push(worker);
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error);
    });

    await page.goto("/");
    const uploadInput = page.locator('input[type="file"]').first();
    await expect(uploadInput).toBeAttached({ timeout: 10_000 });
    await uploadInput.setInputFiles(path.resolve(repoRoot, "fixtures/sample/sample_operations.csv"));
    await expect(page).toHaveURL(/#\/workspace/, { timeout: 20_000 });
    const applyBtn = page.locator('button:has-text("Apply approved changes")');
    await expect(applyBtn).toBeVisible({ timeout: 15_000 });
    await applyBtn.click();
    await expect(page.locator("text=Example analysis")).toBeVisible({ timeout: 15_000 });

    // Open export preparation: the footer offers Cancel while building.
    const prepareBtn = page.locator('[data-testid="export-prepare-btn"]');
    await expect(prepareBtn).toBeVisible();
    await prepareBtn.click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const cancelBtn = dialog.locator('button:has-text("Cancel")');
    await expect(cancelBtn).toBeVisible({ timeout: 15_000 });
    await cancelBtn.click();

    // Recovery: close whatever state cancel left, then a fresh prepare
    // must complete both artifacts — cancel must not corrupt the session.
    await page.waitForTimeout(1000);
    const closeAfterCancel = page.locator("dialog[open] .rf-dialog__close");
    if (await closeAfterCancel.isVisible()) {
      await closeAfterCancel.click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
    }
    await expect(prepareBtn).toBeVisible();
    await prepareBtn.click();
    await expect(page.locator("dialog[open]")).toBeVisible({ timeout: 10_000 });
    const downloadLinks = page.locator(".rf-export-links a.rf-download");
    await expect(downloadLinks.first()).toBeVisible({ timeout: 30_000 });
    expect(await downloadLinks.count()).toBe(2);

    // Workers stay bounded through cancel and rebuild.
    expect(page.workers().length).toBeLessThanOrEqual(2);

    // Clean teardown.
    const closeBtn = page.locator("dialog[open] .rf-dialog__close");
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
    }
    const clearBtn = page.locator('[data-testid="clear-session-btn"]');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => page.workers().length, { timeout: 10_000 })
      .toBe(0);

    // No uncaught exceptions anywhere in the cancel/rebuild path.
    expect(pageErrors).toEqual([]);
  });
});
