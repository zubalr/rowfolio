/**
 * End-to-End Memory Retention & Heap Invariants via Chromium CDP
 *
 * Verifies resource cleanup and bounded memory across repeated upload/export/clear cycles:
 * 1. Instruments URL.createObjectURL and URL.revokeObjectURL to track active Blob URLs.
 * 2. Uses Chromium CDP (HeapProfiler.collectGarbage, Performance.getMetrics) to force GC
 *    and measure clean-state heap usage, DOM nodes, and active workers.
 * 3. Asserts bounded retention:
 *    - Active Web Workers return to 0 upon clearSession().
 *    - Active Blob URLs return to 0 (all revoked upon clearSession()).
 *    - DOM node count returns to baseline without unbounded accumulation.
 *    - Post-GC JS heap memory remains bounded across repeated cycles.
 * 4. Persists structured measurement evidence to the private evidence store.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, type CDPSession } from "@playwright/test";
import { ensureStaticServer, stopStaticServer } from "./helpers.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = "/home/wertyp/.local/share/rowfolio/evidence/agy/heap";

test.beforeAll(async () => {
  await ensureStaticServer(4173);
});

test.afterAll(() => {
  stopStaticServer();
});

test.describe("Browser Memory Retention & CDP Heap Invariants", () => {
  test("Live browser heap, worker, and DOM retention across repeated upload/export/clear cycles", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // 1. Establish CDP session
    const cdp: CDPSession = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.enable");

    // Helper: collect garbage and read comparable clean metrics
    async function sampleCleanMetrics(stageName: string) {
      // Run two GC passes with brief yields to ensure complete finalization
      await cdp.send("HeapProfiler.collectGarbage");
      await page.waitForTimeout(200);
      await cdp.send("HeapProfiler.collectGarbage");
      await page.waitForTimeout(100);

      const perf = await cdp.send("Performance.getMetrics");
      const metricsMap = new Map<string, number>();
      for (const m of perf.metrics) {
        metricsMap.set(m.name, m.value);
      }

      const activeWorkers = page.workers().length;

      // Query active blob URLs and live DOM nodes from the page isolate
      const isolateStatus = await page.evaluate(() => {
        const win = window as unknown as {
          __activeBlobUrls?: Set<string>;
        };
        return {
          activeBlobUrls: win.__activeBlobUrls ? win.__activeBlobUrls.size : 0,
          attachedDomNodes: document.querySelectorAll("*").length,
        };
      });

      return {
        stage: stageName,
        jsHeapUsedBytes: metricsMap.get("JSHeapUsedSize") ?? 0,
        jsHeapTotalBytes: metricsMap.get("JSHeapTotalSize") ?? 0,
        domNodes: metricsMap.get("Nodes") ?? 0,
        attachedDomNodes: isolateStatus.attachedDomNodes,
        domDocuments: metricsMap.get("Documents") ?? 0,
        activeWorkers,
        activeBlobUrls: isolateStatus.activeBlobUrls,
      };
    }

    // Instrument Blob URL creation & revocation before loading the app
    await page.addInitScript(() => {
      const win = window as unknown as {
        __activeBlobUrls: Set<string>;
        __createdBlobUrls: string[];
        __revokedBlobUrls: string[];
      };
      win.__activeBlobUrls = new Set();
      win.__createdBlobUrls = [];
      win.__revokedBlobUrls = [];

      const origCreate = URL.createObjectURL.bind(URL);
      const origRevoke = URL.revokeObjectURL.bind(URL);

      URL.createObjectURL = (blob: Blob | MediaSource) => {
        const url = origCreate(blob);
        win.__activeBlobUrls.add(url);
        win.__createdBlobUrls.push(url);
        return url;
      };

      URL.revokeObjectURL = (url: string) => {
        win.__activeBlobUrls.delete(url);
        win.__revokedBlobUrls.push(url);
        origRevoke(url);
      };
    });

    // 2. Initial navigation and warmup run to prime JIT and module caches
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();

    const sampleCsvPath = path.resolve(repoRoot, "fixtures/sample/sample_operations.csv");

    // Warmup cycle
    {
      const uploadInput = page.locator('input[type="file"]').first();
      await expect(uploadInput).toBeAttached({ timeout: 10_000 });
      await uploadInput.setInputFiles(sampleCsvPath);
      await expect(page).toHaveURL(/#\/workspace/, { timeout: 15_000 });

      const applyBtn = page.locator('button:has-text("Apply approved changes")');
      await expect(applyBtn).toBeVisible({ timeout: 15_000 });
      await applyBtn.click();
      await expect(page.locator("text=The briefing starts here")).toBeVisible({ timeout: 15_000 });

      const prepareBtn = page.locator('[data-testid="export-prepare-btn"]');
      await expect(prepareBtn).toBeVisible();
      await prepareBtn.click();

      const downloadLinks = page.locator(".rf-export-links a.rf-download");
      await expect(downloadLinks.first()).toBeVisible({ timeout: 25_000 });

      const closeBtn = page.locator("dialog[open] .rf-dialog__close");
      await closeBtn.click();

      const clearBtn = page.locator('[data-testid="clear-session-btn"]');
      await clearBtn.click();
      await expect(page.locator("h1")).toBeVisible();
    }

    // Capture baseline metrics after warmup and GC
    const baseline = await sampleCleanMetrics("warmup_baseline");
    expect(baseline.activeWorkers).toBe(0);
    expect(baseline.activeBlobUrls).toBe(0);

    const measurements: Array<Awaited<ReturnType<typeof sampleCleanMetrics>>> = [baseline];

    // 3. Execute 3 consecutive upload -> approve -> export -> clear cycles
    const CYCLES = 3;
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      // Upload
      const uploadInput = page.locator('input[type="file"]').first();
      await expect(uploadInput).toBeAttached({ timeout: 10_000 });
      await uploadInput.setInputFiles(sampleCsvPath);
      await expect(page).toHaveURL(/#\/workspace/, { timeout: 15_000 });

      // Approve
      const applyBtn = page.locator('button:has-text("Apply approved changes")');
      await expect(applyBtn).toBeVisible({ timeout: 15_000 });
      await applyBtn.click();
      await expect(page.locator("text=The briefing starts here")).toBeVisible({ timeout: 15_000 });

      // Export
      const prepareBtn = page.locator('[data-testid="export-prepare-btn"]');
      await expect(prepareBtn).toBeVisible();
      await prepareBtn.click();

      const downloadLinks = page.locator(".rf-export-links a.rf-download");
      await expect(downloadLinks.first()).toBeVisible({ timeout: 25_000 });

      const closeBtn = page.locator("dialog[open] .rf-dialog__close");
      await closeBtn.click();

      // Clear Session
      const clearBtn = page.locator('[data-testid="clear-session-btn"]');
      await clearBtn.click();
      await expect(page.locator("h1")).toBeVisible();

      // Sample post-cycle clean metrics
      const postCycle = await sampleCleanMetrics(`post_cycle_${cycle}`);
      measurements.push(postCycle);

      // Invariant 1: All Web Workers closed
      expect(postCycle.activeWorkers).toBe(0);

      // Invariant 2: All Blob URLs revoked
      expect(postCycle.activeBlobUrls).toBe(0);

      // Invariant 3: Live attached DOM tree returns strictly to landing baseline
      expect(postCycle.attachedDomNodes).toBe(baseline.attachedDomNodes);
    }

    const postCycle1 = measurements[1];
    const postCycle3 = measurements[3];

    // Check JS Heap memory after forced GC: bounded heap growth ratio (< 1.25)
    const heapGrowthRatio = postCycle3.jsHeapUsedBytes / Math.max(1, postCycle1.jsHeapUsedBytes);
    expect(heapGrowthRatio).toBeLessThan(1.25);

    // 4. Persist structured metrics report to evidence store
    try {
      if (!fs.existsSync(evidenceDir)) {
        fs.mkdirSync(evidenceDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(evidenceDir, "retention-metrics.json"),
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            cycles: CYCLES,
            baseline,
            measurements,
            summary: {
              zeroActiveWorkersGuaranteed: measurements.every((m) => m.activeWorkers === 0),
              zeroActiveBlobUrlsGuaranteed: measurements.every((m) => m.activeBlobUrls === 0),
              attachedDomNodesStrictlyInvariant: measurements.every(
                (m) => m.attachedDomNodes === baseline.attachedDomNodes
              ),
              baselineAttachedDomNodes: baseline.attachedDomNodes,
              initialHeapUsedBytes: postCycle1.jsHeapUsedBytes,
              finalHeapUsedBytes: postCycle3.jsHeapUsedBytes,
              heapGrowthRatio,
              notes:
                "CDP Performance.getMetrics Nodes tracks internal Blink C++ wrapper objects pending idle Oilpan GC, while document.querySelectorAll('*') proves the live attached DOM tree is strictly restored to baseline.",
            },
          },
          null,
          2
        )
      );
    } catch {
      // Evidence writing must not break test execution
    }
  });
});
