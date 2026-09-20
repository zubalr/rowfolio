import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  declaredDependencies,
  loadLockfile,
  loadPackageJson,
  repoRoot,
  sha256,
} from "../lib/workspace.ts";

const EXPECTED_PACKAGES = [
  "contracts",
  "i18n",
  "ui",
  "charts",
  "ingest",
  "normalize",
  "analysis",
  "provenance",
  "scenario",
  "export-model",
  "export-xlsx",
  "export-pptx",
];

const EXACT_SPEC = /^(\d+\.\d+\.\d+|file:|workspace:)/;

describe("workspace contract", () => {
  it("every architecture package exists with a conforming entry surface", () => {
    for (const name of EXPECTED_PACKAGES) {
      const dir = path.join(repoRoot, "packages", name);
      const pkg = loadPackageJson(dir);
      expect(pkg.name, name).toBe(`@rowfolio/${name}`);
      expect(pkg.private, name).toBe(true);
      expect(pkg.type, name).toBe("module");
      expect(pkg.exports?.["."], name).toBe("./src/index.ts");
      expect(existsSync(path.join(dir, "tsconfig.json")), `${name} tsconfig`).toBe(true);
      expect(existsSync(path.join(dir, "src", "index.ts")), `${name} entry`).toBe(true);
    }
  });

  it("every declared dependency is exact-pinned, vendored, or workspace-linked", () => {
    for (const dep of declaredDependencies()) {
      expect(
        EXACT_SPEC.test(dep.spec),
        `${dep.dir}: ${dep.name}@${dep.spec} is not an exact pin`,
      ).toBe(true);
    }
  });

  it("xlsx is declared only by @rowfolio/ingest and only as the vendored tarball", () => {
    const xlsx = declaredDependencies().filter((d) => d.name === "xlsx");
    expect(xlsx).toHaveLength(1);
    expect(xlsx[0]?.dir).toBe("packages/ingest");
    expect(xlsx[0]?.spec).toBe("file:../../vendor/xlsx-0.20.3.tgz");
  });

  it("vendored SheetJS tarball matches the recorded official SHA-256", () => {
    expect(sha256(path.join(repoRoot, "vendor", "xlsx-0.20.3.tgz"))).toBe(
      "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8",
    );
  });

  it("the lockfile resolves xlsx to the vendored tarball, not the registry", () => {
    const lockfile = loadLockfile();
    const keys = Object.keys(lockfile.packages ?? {});
    const xlsxKeys = keys.filter((k) => /^xlsx@/.test(k));
    expect(xlsxKeys).toEqual(["xlsx@file:vendor/xlsx-0.20.3.tgz"]);
  });

  it("locks the package manager and records the Node version", () => {
    const root = loadPackageJson(repoRoot);
    expect(root.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    const nodeVersion = readdirSync(repoRoot).includes(".node-version");
    expect(nodeVersion).toBe(true);
  });

  it("no workspace manifest declares a server framework, auth, analytics or model SDK", () => {
    const banned = /^(express|fastify|koa|hono|next|openai|aws-sdk|firebase|mixpanel|posthog-js|wrangler)$|^@(anthropic-ai|google-ai|sentry|aws-sdk|supabase|segment|amplitude|firebase|vercel)\//;
    for (const dep of declaredDependencies()) {
      expect(banned.test(dep.name), `${dep.dir}: ${dep.name}`).toBe(false);
    }
  });
});
