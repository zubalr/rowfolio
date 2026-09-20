#!/usr/bin/env node
/**
 * pnpm audit:licenses
 *
 * Verifies, against the real installed tree + lockfile:
 *  1. every resolved package carries a license on the permissive allowlist, or
 *     is a documented, scoped exception;
 *  2. the vendored SheetJS tarball hash still matches the recorded SHA-256 and
 *     the lockfile still points at the vendored tarball (never the registry);
 *  3. no banned runtime dependency (server/auth/analytics/model SDK) exists;
 *  4. committed generated files (dependency-inventory.json,
 *     THIRD_PARTY_NOTICES.md) match what `report-freeze` would regenerate —
 *     i.e. the dependency tree cannot drift without regenerating the report.
 *
 * Exits non-zero on any violation.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  declaredDependencies,
  licenseReport,
  loadLockfile,
  repoRoot,
  resolvedPackages,
  sha256,
} from "./lib/workspace.ts";
import { buildInventory, buildNotices } from "./lib/freeze-report.ts";

const XLSX_SHA256 = "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8";

const PERMISSIVE = new Set([
  "MIT",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Unlicense",
  "BlueOak-1.0.0",
  "MIT/X11",
  "X11",
  "Zlib",
  "(MIT AND Zlib)",
  "CC0-1.0",
  "CC-BY-4.0",
  "WTFPL",
  "Python-2.0",
  "OFL-1.1",
]);

// Licenses that are dual-offered with a permissive option we elect.
const DUAL_LICENSED_PERMISSIVE_CHOICE = /\(MIT OR .*\)/;

// Name-scoped documented exceptions. Each must have a reason recorded in
// DEPENDENCY_FREEZE.md; nothing here suppresses a package silently.
const EXCEPTIONS = {
  // exceljs@4.4.0 transitive (via unzipper): upstream tarball ships no LICENSE
  // declaration; package predates SPDX convention. Flagged in
  // DEPENDENCY_FREEZE.md as maintenance risk pending the export-gate review.
  buffers: "undeclared upstream license; exceljs transitive; flagged for owner review",
  // MPL-2.0 dev/build-time only: unmodified tool dependency, never shipped in
  // the app bundle. axe-core is a test-only dependency; lightningcss is a
  // build-time CSS transformer inside the bundler toolchain.
  "axe-core": "MPL-2.0 dev-only test tool (unmodified), not shipped",
  // Prefix match also covers lightningcss-<platform>-<arch> binary packages.
  lightningcss: "MPL-2.0 build-time tool dependency, not shipped",
};

const exceptionFor = (name: string): string | undefined =>
  Object.keys(EXCEPTIONS).find((k) => name === k || name.startsWith(`${k}-`));

const BANNED = [
  /^express$/, /^fastify$/, /^koa$/, /^hono$/, /^next$/,
  /^openai$/, /^@anthropic-ai\//, /^@google(-ai)?\//, /^@google\/generative-ai$/,
  /^firebase/, /^@firebase\//, /^@supabase\//, /^aws-sdk$/, /^@aws-sdk\//,
  /^@sentry\//, /^posthog/, /^@posthog\//, /^@segment\//, /^mixpanel/, /^@amplitude\//,
  /^applicationinsights$/, /^@vercel\//, /^netlify/, /^wrangler$/,
];

let failures = 0;
const fail = (msg: string): void => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};
const ok = (msg: string): void => {
  console.log(`ok   ${msg}`);
};

// --- 1. license allowlist ---------------------------------------------------
const report = licenseReport();
for (const [license, items] of Object.entries(report)) {
  for (const item of items) {
    const name = item.name;
    if (exceptionFor(name)) continue;
    if (PERMISSIVE.has(license) || DUAL_LICENSED_PERMISSIVE_CHOICE.test(license)) continue;
    fail(`${name}@${(item.versions ?? []).join(",")} has non-allowlisted license "${license}"`);
  }
}
const total = Object.values(report).reduce((n, items) => n + items.length, 0);
if (failures === 0) ok(`all ${total} installed packages carry allowlisted or documented-exception licenses`);

// --- 2. vendored SheetJS ----------------------------------------------------
const tgz = path.join(repoRoot, "vendor", "xlsx-0.20.3.tgz");
if (!existsSync(tgz)) {
  fail("vendor/xlsx-0.20.3.tgz is missing — SheetJS must be vendored");
} else if (sha256(tgz) !== XLSX_SHA256) {
  fail("vendor/xlsx-0.20.3.tgz SHA-256 does not match recorded official bytes");
} else {
  ok("vendored xlsx-0.20.3.tgz matches recorded SHA-256");
}

const lockfile = loadLockfile();
const xlsx = resolvedPackages(lockfile).find((p) => p.name === "xlsx");
if (!xlsx) {
  fail("xlsx is not present in pnpm-lock.yaml");
} else if (xlsx.version !== "file:vendor/xlsx-0.20.3.tgz" && xlsx.tarball !== "file:vendor/xlsx-0.20.3.tgz") {
  fail(`xlsx lockfile resolution is "${xlsx.version}" — must resolve to the vendored tarball`);
} else {
  ok("xlsx resolves to vendored tarball (never the stale registry)");
}

// --- 3. banned dependencies --------------------------------------------------
for (const dep of declaredDependencies()) {
  if (BANNED.some((re) => re.test(dep.name))) {
    fail(`banned dependency "${dep.name}" declared in ${dep.dir}/package.json`);
  }
}
for (const pkg of resolvedPackages(lockfile)) {
  if (BANNED.some((re) => re.test(pkg.name))) {
    fail(`banned package "${pkg.name}" present in lockfile`);
  }
}
ok("no server/auth/analytics/model-SDK packages declared or resolved");

// --- 4. committed freeze artifacts fresh ------------------------------------
const inventoryPath = path.join(repoRoot, "dependency-inventory.json");
const noticesPath = path.join(repoRoot, "THIRD_PARTY_NOTICES.md");
const inventory = buildInventory();
const notices = buildNotices();
const generated: [string, string][] = [
  [inventoryPath, inventory],
  [noticesPath, notices],
];
for (const [p, expected] of generated) {
  if (!existsSync(p)) {
    fail(`${path.basename(p)} missing — run \`pnpm report:freeze\` and commit the result`);
    continue;
  }
  if (readFileSync(p, "utf8") !== expected) {
    fail(`${path.basename(p)} is stale — run \`pnpm report:freeze\` and commit the regenerated file`);
  } else {
    ok(`${path.basename(p)} matches installed tree`);
  }
}

// Machine-readable summary for CI logs.
console.log(
  JSON.stringify({
    packages: total,
    exceptions: Object.keys(EXCEPTIONS),
    status: failures === 0 ? "pass" : "fail",
  }),
);
process.exit(failures === 0 ? 0 : 1);
