import { test, expect } from "@playwright/test";
import { ensureStaticServer, stopStaticServer } from "./helpers.ts";

test.beforeAll(async () => {
  await ensureStaticServer(4173);
});

test.afterAll(() => {
  stopStaticServer();
});

test.describe("Strict Network Interception & Canary Isolation", () => {
  test("allows only GET/HEAD requests to same-origin static assets", async ({ page }) => {
    const nonStaticRequests: Array<{ url: string; method: string }> = [];

    await page.route("**", (route) => {
      const request = route.request();
      const method = request.method();
      const url = request.url();

      if (method !== "GET" && method !== "HEAD") {
        nonStaticRequests.push({ url, method });
        return route.abort("blockedbyclient");
      }

      // Check for third-party hostnames
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost") {
        nonStaticRequests.push({ url, method });
        return route.abort("blockedbyclient");
      }

      return route.continue();
    });

    await page.goto("/");
    expect(nonStaticRequests).toEqual([]);
  });

  test("canary string never leaks into outgoing network requests", async ({ page }) => {
    const CANARY_TOKEN = "CANARY_TOKEN_E2E_VERIFICATION_883921_SECRET";
    const leakedRequests: string[] = [];

    await page.route("**", (route) => {
      const request = route.request();
      const postData = request.postData() ?? "";
      const url = request.url();

      if (url.includes(CANARY_TOKEN) || postData.includes(CANARY_TOKEN)) {
        leakedRequests.push(`Leaked in ${request.method()} ${url}`);
      }

      return route.continue();
    });

    await page.goto("/");

    // Inject canary token into local browser memory
    await page.evaluate((canary) => {
      (window as unknown as { canaryTestData: string }).canaryTestData = canary;
    }, CANARY_TOKEN);

    // Assert that no request ever carried the canary
    expect(leakedRequests).toEqual([]);
  });

  test("synthetic file upload with high-entropy canary never leaks into network requests, storage, or console", async ({ page }) => {
    const CANARY_TOKEN = "CANARY_SYNTHETIC_HIGH_ENTROPY_9f8b1c2d3e4a5b6c";
    const interceptedRequests: Array<{ method: string; url: string }> = [];
    const leakedRequests: string[] = [];
    const consoleLogs: string[] = [];

    // 1. Intercept and log all outgoing network requests
    await page.route("**", (route) => {
      const req = route.request();
      const method = req.method();
      const url = req.url();
      const postData = req.postData() ?? "";

      interceptedRequests.push({ method, url });

      if (url.includes(CANARY_TOKEN) || postData.includes(CANARY_TOKEN)) {
        leakedRequests.push(`Leaked in ${method} ${url} (postData: ${postData})`);
      }

      return route.continue();
    });

    // 2. Capture console messages
    page.on("console", (msg) => {
      consoleLogs.push(msg.text());
    });

    await page.goto("/");

    // 3. Construct synthetic CSV containing the high-entropy canary
    const syntheticCsvContent = [
      "operation_id,date,region,site,revenue,target_revenue,order_volume,operating_cost,downtime_minutes,maintenance_cost,csat_score",
      `OP-CANARY-01,2026-03-02,North,${CANARY_TOKEN},7995.57,9916.70,69,5090.50,11,356.33,78`,
      "OP-CANARY-02,2026-03-02,North,NO-02,10463.34,10412.53,78,4964.81,9,546.12,92",
    ].join("\n");

    const uploadInput = page.locator('input[type="file"]').first();
    await expect(uploadInput).toBeAttached({ timeout: 10_000 });

    await uploadInput.setInputFiles({
      name: "synthetic_canary_operations.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(syntheticCsvContent),
    });

    // 4. Verify route transition to workspace
    await expect(page).toHaveURL(/#\/workspace/, { timeout: 15_000 });

    // 5. If review panel appears, approve changes
    const applyBtn = page.locator('button:has-text("Apply approved changes")');
    if (await applyBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await applyBtn.click();
    }

    // 6. Verify zero canary leakage in all network requests
    expect(leakedRequests).toEqual([]);

    // 7. Verify zero canary in browser persistent storage
    const storageCanaries = await page.evaluate((canary) => {
      const leaks: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) ?? "";
        const val = localStorage.getItem(key) ?? "";
        if (key.includes(canary) || val.includes(canary)) leaks.push(`localStorage: ${key}`);
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i) ?? "";
        const val = sessionStorage.getItem(key) ?? "";
        if (key.includes(canary) || val.includes(canary)) leaks.push(`sessionStorage: ${key}`);
      }
      return leaks;
    }, CANARY_TOKEN);
    expect(storageCanaries).toEqual([]);

    // 8. Verify zero canary in browser console logs
    const consoleLeaks = consoleLogs.filter((log) => log.includes(CANARY_TOKEN));
    expect(consoleLeaks).toEqual([]);

    // 9. Verify only same-origin GET/HEAD requests were dispatched
    expect(interceptedRequests.length).toBeGreaterThan(0);
    for (const req of interceptedRequests) {
      expect(["GET", "HEAD"]).toContain(req.method);
      const parsed = new URL(req.url);
      expect(["127.0.0.1", "localhost"]).toContain(parsed.hostname);
    }
  });
});
