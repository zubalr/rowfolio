import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  declaredDependencies,
  licenseReport,
  loadLockfile,
  repoRoot,
  resolvedPackages,
} from "./workspace.ts";
import type { LicenseItem, Lockfile } from "./workspace.ts";

const NODE_VERSION = readFileSync(path.join(repoRoot, ".node-version"), "utf8").trim();

function licenseIndex(): Map<string, LicenseItem[]> {
  const report = licenseReport();
  const byName = new Map<string, LicenseItem[]>();
  for (const items of Object.values(report)) {
    for (const item of items) {
      const list = byName.get(item.name) ?? [];
      list.push(item);
      byName.set(item.name, list);
    }
  }
  return byName;
}

// snapshots: keys carry peer suffixes "name@ver(peer@ver(...))" — possibly
// nested; packages: keys are plain "name@version". Strip the parenthesized
// suffixes depth-aware to normalize to the plain packages key.
function stripParens(key: string): string {
  let out = "";
  let depth = 0;
  for (const ch of key) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0) out += ch;
  }
  return out;
}

type Scope = "runtime" | "development";

/** Reachability walk over the lockfile snapshot graph. */
function computeScopes(lockfile: Lockfile): Map<string, Set<Scope>> {
  const scopeOf = new Map<string, Set<Scope>>();
  const mark = (key: string, scope: Scope): void => {
    const plain = stripParens(key);
    const set = scopeOf.get(plain) ?? new Set<Scope>();
    set.add(scope);
    scopeOf.set(plain, set);
  };
  const snapshots = lockfile.snapshots ?? {};
  const visit = (key: string, scope: Scope, seen: Set<string>): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const snap = snapshots[key];
    if (!snap) return;
    for (const section of ["dependencies", "optionalDependencies"] as const) {
      for (const [depName, depRef] of Object.entries(snap[section] ?? {})) {
        const depKey = `${depName}@${depRef}`;
        mark(depKey, scope);
        visit(depKey, scope, seen);
      }
    }
  };
  for (const importer of Object.values(lockfile.importers ?? {})) {
    for (const section of ["dependencies", "peerDependencies", "optionalDependencies"] as const) {
      for (const [depName, info] of Object.entries(importer[section] ?? {})) {
        if (info.version?.startsWith("link:")) continue;
        const key = `${depName}@${info.version}`;
        mark(key, "runtime");
        visit(key, "runtime", new Set());
      }
    }
    for (const [depName, info] of Object.entries(importer.devDependencies ?? {})) {
      if (info.version?.startsWith("link:")) continue;
      const key = `${depName}@${info.version}`;
      mark(key, "development");
      visit(key, "development", new Set());
    }
  }
  return scopeOf;
}

function scopeLabel(scopes: Set<Scope>): string {
  if (scopes.has("runtime") && scopes.has("development")) return "runtime+development";
  if (scopes.has("runtime")) return "runtime";
  if (scopes.has("development")) return "development";
  return "unreachable";
}

export function buildInventory(): string {
  const lockfile = loadLockfile();
  const licenses = licenseIndex();
  const scopes = computeScopes(lockfile);

  const declaredIn = new Map<string, Set<string>>();
  for (const dep of declaredDependencies()) {
    if (dep.spec.startsWith("workspace:")) continue;
    const list = declaredIn.get(dep.name) ?? new Set<string>();
    list.add(dep.dir);
    declaredIn.set(dep.name, list);
  }

  const packages = resolvedPackages(lockfile)
    .filter((p) => !p.name.startsWith("@pnpm/exe"))
    .map((p) => {
      const lic = licenses.get(p.name)?.find((i) => i.versions?.includes(p.version));
      return {
        name: p.name,
        version: p.version,
        license: lic?.license ?? "Unknown",
        scope: scopeLabel(scopes.get(stripParens(p.key)) ?? new Set<Scope>()),
        integrity: p.integrity,
        source: p.tarball ?? "npmjs",
        declaredIn: [...(declaredIn.get(p.name) ?? [])].sort(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const inventory = {
    schema: "rowfolio/dependency-inventory@1",
    tool: { node: NODE_VERSION, packageManager: "pnpm@12.5.1" },
    packageCount: packages.length,
    packages,
    vendored: [
      {
        file: "vendor/xlsx-0.20.3.tgz",
        name: "xlsx",
        version: "0.20.3",
        license: "Apache-2.0",
        sha256: "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8",
        upstream: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
      },
    ],
  };
  return JSON.stringify(inventory, null, 2) + "\n";
}

function findLicenseText(pkgPath: string | undefined): { file: string; text: string } | null {
  if (!pkgPath || !existsSync(pkgPath)) return null;
  for (const f of readdirSync(pkgPath)) {
    if (/^(licen[sc]e|copying)/i.test(f)) {
      const full = path.join(pkgPath, f);
      try {
        const text = readFileSync(full, "utf8");
        if (text.trim().length > 100) return { file: f, text: text.trim() };
      } catch {
        /* not a readable file */
      }
    }
  }
  return null;
}

export function buildNotices(): string {
  const licenses = licenseIndex();
  const direct = [...new Set(declaredDependencies().filter((d) => !d.spec.startsWith("workspace:")).map((d) => d.name))].sort();

  const lines: string[] = [];
  lines.push("# Third-party notices");
  lines.push("");
  lines.push(
    "Rowfolio is MIT-licensed original code. The packages below are distributed with",
    "or used to build it and retain their own licenses. This file is generated by",
    "`pnpm report:freeze` from the installed tree — do not edit by hand.",
    "Regenerate after any dependency change.",
    "",
  );
  lines.push("## Direct dependencies");
  lines.push("");
  for (const name of direct) {
    const items = licenses.get(name) ?? [];
    const item = items[0];
    const version = item?.versions?.join(", ") ?? "vendored";
    const license = item?.license ?? (name === "xlsx" ? "Apache-2.0" : "Unknown");
    lines.push(`### ${name}@${version} — ${license}`);
    lines.push("");
    const pkgPath = item?.paths?.[0];
    const text = pkgPath ? findLicenseText(pkgPath) : null;
    if (name === "xlsx") {
      const vendored = items
        .flatMap((i) => i.paths ?? [])
        .map((p) => findLicenseText(p))
        .find(Boolean);
      if (vendored) {
        lines.push("```", vendored.text, "```", "");
      } else {
        lines.push("Apache License 2.0 (license text inside `vendor/xlsx-0.20.3.tgz`).", "");
      }
    } else if (text) {
      lines.push("```", text.text, "```", "");
    } else {
      lines.push(`License text not shipped in package; license field: ${license}.`, "");
    }
  }
  lines.push("## Full dependency tree");
  lines.push("");
  lines.push("See `dependency-inventory.json` for the complete machine-readable");
  lines.push("name/version/license/integrity inventory of every resolved package.");
  lines.push("");
  return lines.join("\n") + "\n";
}
