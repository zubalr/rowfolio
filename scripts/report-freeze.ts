#!/usr/bin/env node
/**
 * pnpm report:freeze — regenerates the committed dependency-freeze artifacts:
 *   dependency-inventory.json   machine-readable SPDX-style inventory
 *   THIRD_PARTY_NOTICES.md      license notices for direct dependencies
 *
 * Run with --write after any dependency change and commit the results.
 * `pnpm audit:licenses` fails if these files are stale.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./lib/workspace.ts";
import { buildInventory, buildNotices } from "./lib/freeze-report.ts";

const inventory = buildInventory();
const notices = buildNotices();

if (process.argv.includes("--write")) {
  writeFileSync(path.join(repoRoot, "dependency-inventory.json"), inventory);
  writeFileSync(path.join(repoRoot, "THIRD_PARTY_NOTICES.md"), notices);
  console.log("wrote dependency-inventory.json and THIRD_PARTY_NOTICES.md");
} else {
  console.log(JSON.stringify({ inventoryBytes: inventory.length, noticesBytes: notices.length }));
  console.log("dry run — pass --write to commit the regenerated files");
}
