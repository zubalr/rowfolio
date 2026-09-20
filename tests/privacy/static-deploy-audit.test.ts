import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditStaticDirectory,
  scanSourceForBannedImports,
  ALLOWED_STATIC_EXTENSIONS,
  ALLOWED_BARE_FILES,
  FORBIDDEN_NAMES,
} from "../../tooling/audits/static-deploy-audit.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("static deploy auditor (A20)", () => {
  it("passes banned imports scan across all packages and apps", () => {
    const result = scanSourceForBannedImports(repoRoot);
    expect(result.violations).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("identifies allowed static file extensions and bare files", () => {
    expect(ALLOWED_STATIC_EXTENSIONS.has(".html")).toBe(true);
    expect(ALLOWED_STATIC_EXTENSIONS.has(".js")).toBe(true);
    expect(ALLOWED_STATIC_EXTENSIONS.has(".css")).toBe(true);
    expect(ALLOWED_STATIC_EXTENSIONS.has(".json")).toBe(true);
    expect(ALLOWED_STATIC_EXTENSIONS.has(".wasm")).toBe(false);
    expect(ALLOWED_STATIC_EXTENSIONS.has(".exe")).toBe(false);
    expect(ALLOWED_STATIC_EXTENSIONS.has(".sh")).toBe(false);

    expect(ALLOWED_BARE_FILES.has("_headers")).toBe(true);
    expect(ALLOWED_BARE_FILES.has("_redirects")).toBe(true);
  });

  it("detects forbidden serverless and environment names", () => {
    expect(FORBIDDEN_NAMES.some((re) => re.test("functions"))).toBe(true);
    expect(FORBIDDEN_NAMES.some((re) => re.test("_worker.js"))).toBe(true);
    expect(FORBIDDEN_NAMES.some((re) => re.test("_worker.ts"))).toBe(true);
    expect(FORBIDDEN_NAMES.some((re) => re.test(".env"))).toBe(true);
    expect(FORBIDDEN_NAMES.some((re) => re.test(".env.local"))).toBe(true);
    expect(FORBIDDEN_NAMES.some((re) => re.test("index.html"))).toBe(false);
  });

  it("audits existing apps/web/dist when present", () => {
    const distDir = path.resolve(repoRoot, "apps/web/dist");
    const result = auditStaticDirectory(distDir);
    if (result.checks.find((c) => c.id === "dist-exists" && c.status === "pass")) {
      expect(result.errors).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.checks.some((c) => c.id === "no-serverless-workers" && c.status === "pass")).toBe(true);
    } else {
      expect(result.passed).toBe(false);
    }
  });
});
