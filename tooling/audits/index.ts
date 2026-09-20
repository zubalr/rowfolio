/**
 * Verification & Audit Tooling Suite
 *
 * Programmatic interface and CLI runner for:
 * 1. Static deployment integrity and positive manifest audit
 * 2. AST banned import scan (privacy and cost guarantees)
 * 3. Browser storage privacy audit (zero persistence of spreadsheet data)
 * 4. Bundle performance budget and lazy-chunk audit
 */
import path from "node:path";
import {
  auditStaticDirectory,
  scanSourceForBannedImports,
  scanSourceForStorageViolations,
} from "./static-deploy-audit.ts";
import { auditBundleBudgets } from "./bundle-budget-audit.ts";

export * from "./static-deploy-audit.ts";
export * from "./bundle-budget-audit.ts";

export interface FullAuditSummary {
  timestamp: string;
  allPassed: boolean;
  staticAudit: ReturnType<typeof auditStaticDirectory>;
  bannedImports: ReturnType<typeof scanSourceForBannedImports>;
  storageAudit: ReturnType<typeof scanSourceForStorageViolations>;
  bundleBudgets: ReturnType<typeof auditBundleBudgets>;
}

export function runFullAudit(rootDir: string, distRelPath = "apps/web/dist"): FullAuditSummary {
  const distDir = path.resolve(rootDir, distRelPath);
  const staticAudit = auditStaticDirectory(distDir);
  const bannedImports = scanSourceForBannedImports(rootDir);
  const storageAudit = scanSourceForStorageViolations(rootDir);
  const bundleBudgets = auditBundleBudgets(distDir);

  const allPassed =
    staticAudit.passed && bannedImports.passed && storageAudit.passed && bundleBudgets.passed;

  return {
    timestamp: new Date().toISOString(),
    allPassed,
    staticAudit,
    bannedImports,
    storageAudit,
    bundleBudgets,
  };
}
