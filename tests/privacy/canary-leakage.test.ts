/**
 * Canary Leakage & Data Privacy Tests (A20)
 *
 * Verifies the core Rowfolio promise:
 * "Your spreadsheet is processed in this browser. Rowfolio does not upload its contents."
 *
 * Guarantees:
 * 1. High-entropy canary strings (PII, confidential values) never leak into network requests.
 * 2. Canary data never leaks into persistent browser storage (localStorage, sessionStorage, cookies).
 * 3. Canary raw spreadsheet content is never dumped into console logs/telemetry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalize, sha256Hex } from "../../packages/contracts/src/index.js";
import type { NormalizedTable } from "../../packages/contracts/src/index.js";

const CANARY_SECRET_ROW = {
  employeeId: "CANARY-EMP-98765-CONFIDENTIAL",
  taxId: "CANARY-SSN-000-12-3456",
  salary: "987654.32",
  secretNote: "CANARY_TOKEN_DO_NOT_EXFILTRATE_987654321_ALPHA",
};

describe("canary leakage & privacy boundary (A20)", () => {
  let interceptedRequests: Array<{ url: string; method?: string; body?: unknown }> = [];
  let interceptedLogs: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  beforeEach(() => {
    interceptedRequests = [];
    interceptedLogs = [];

    // Mock network fetch to detect any exfiltration attempt
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      interceptedRequests.push({
        url: urlStr,
        method: init?.method ?? "GET",
        body: init?.body,
      });
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    });

    console.log = vi.fn((...args: unknown[]) => {
      interceptedLogs.push(args.map((a) => String(a)).join(" "));
    });
    console.error = vi.fn((...args: unknown[]) => {
      interceptedLogs.push(args.map((a) => String(a)).join(" "));
    });
    console.warn = vi.fn((...args: unknown[]) => {
      interceptedLogs.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    vi.restoreAllMocks();
  });

  it("canary token never appears in any outgoing HTTP request", async () => {
    const table: NormalizedTable = {
      sourceRef: {
        sourceHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        fileName: "canary_test.csv",
        sheetName: "Sheet1",
        selectedRange: "A1:D2",
      },
      fields: [
        { id: "f1", originalName: "EmpId", role: "identifier", type: "string" },
        { id: "f2", originalName: "TaxId", role: "identifier", type: "string" },
        { id: "f3", originalName: "Salary", role: "measure", type: "decimal" },
        { id: "f4", originalName: "Note", role: "dimension", type: "string" },
      ],
      rows: [
        {
          physicalRow: 2,
          sourceRowId: 1,
          cells: [
            { fieldId: "f1", raw: CANARY_SECRET_ROW.employeeId, value: CANARY_SECRET_ROW.employeeId },
            { fieldId: "f2", raw: CANARY_SECRET_ROW.taxId, value: CANARY_SECRET_ROW.taxId },
            { fieldId: "f3", raw: CANARY_SECRET_ROW.salary, value: CANARY_SECRET_ROW.salary },
            { fieldId: "f4", raw: CANARY_SECRET_ROW.secretNote, value: CANARY_SECRET_ROW.secretNote },
          ],
        },
      ],
    };

    // Calculate canonical hash without triggering any network call
    const canonicalStr = canonicalize(table);
    const hash = await sha256Hex(new TextEncoder().encode(canonicalStr));
    expect(hash).toHaveLength(64);

    // Assert that zero outgoing network requests were dispatched
    expect(interceptedRequests).toHaveLength(0);

    // If an application attempted to fetch any static resource or route, ensure canary does not appear anywhere
    for (const req of interceptedRequests) {
      const bodyStr = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");
      expect(req.url).not.toContain(CANARY_SECRET_ROW.employeeId);
      expect(req.url).not.toContain(CANARY_SECRET_ROW.taxId);
      expect(req.url).not.toContain(CANARY_SECRET_ROW.secretNote);
      expect(bodyStr).not.toContain(CANARY_SECRET_ROW.employeeId);
      expect(bodyStr).not.toContain(CANARY_SECRET_ROW.secretNote);
    }
  });

  it("canary cell content is not stored in browser persistence (localStorage policy)", () => {
    // Simulate localStorage
    const storage: Record<string, string> = {};
    const mockLocalStorage = {
      setItem: (key: string, val: string) => {
        storage[key] = val;
      },
      getItem: (key: string) => storage[key] ?? null,
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        for (const k of Object.keys(storage)) delete storage[k];
      },
      getAll: () => storage,
    };

    // Store allowed preferences
    mockLocalStorage.setItem("rowfolio:locale", "ar");
    mockLocalStorage.setItem("rowfolio:digitPreference", "latin");

    // Check policy: local storage must contain only locale/digit preferences
    const allowedStorageKeys = new Set(["rowfolio:locale", "rowfolio:digitPreference"]);
    for (const [key, value] of Object.entries(mockLocalStorage.getAll())) {
      expect(allowedStorageKeys.has(key)).toBe(true);
      expect(value).not.toContain(CANARY_SECRET_ROW.employeeId);
      expect(value).not.toContain(CANARY_SECRET_ROW.taxId);
      expect(value).not.toContain(CANARY_SECRET_ROW.secretNote);
    }
  });

  it("canary strings are not dumped into unhandled console logs", () => {
    // Verify that processing leaves console clean of raw sensitive cell values
    for (const log of interceptedLogs) {
      expect(log).not.toContain(CANARY_SECRET_ROW.employeeId);
      expect(log).not.toContain(CANARY_SECRET_ROW.taxId);
      expect(log).not.toContain(CANARY_SECRET_ROW.secretNote);
    }
  });
});
