import { test, expect } from "@playwright/test";
import { ensureStaticServer, stopStaticServer } from "./helpers.js";

test.beforeAll(async () => {
  await ensureStaticServer(4173);
});

test.afterAll(() => {
  stopStaticServer();
});

test.describe("Strict Network Interception & Canary Isolation (A20)", () => {
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
});
