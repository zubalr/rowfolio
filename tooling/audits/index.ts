/**
 * Verification & Audit Tooling Suite (A20)
 *
 * Programmatic interface and CLI runner for:
 * 1. Static deployment integrity and positive manifest audit
 * 2. AST banned import scan (privacy and cost guarantees)
 * 3. Bundle performance budget and lazy-chunk audit
 */
import path from "node:path";
import { auditStaticDirectory, scanSourceForBannedImports } from "./static-deploy-audit.js";
import { auditBundleBudgets } from "./bundle-budget-audit.js";

export * from "./static-deploy-audit.js";
export * from "./bundle-budget-audit.js";

export interface FullAuditSummary {
  timestamp: string;
  allPassed: boolean;
  staticAudit: ReturnType<typeof auditStaticDirectory>;
  bannedImports: ReturnType<typeof scanSourceForBannedImports>;
  bundleBudgets: ReturnType<typeof auditBundleBudgets>;
}

export function runFullAudit(rootDir: string, distRelPath = "apps/web/dist"): FullAuditSummary {
  const distDir = path.resolve(rootDir, distRelPath);
  const staticAudit = auditStaticDirectory(distDir);
  const bannedImports = scanSourceForBannedImports(rootDir);
  const bundleBudgets = auditBundleBudgets(distDir);

  const allPassed = staticAudit.passed && bannedImports.passed && bundleBudgets.passed;

  return {
    timestamp: new Date().toISOString(),
    allPassed,
    staticAudit,
    bannedImports,
    bundleBudgets,
  };
}
