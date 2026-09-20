import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function run(cmd: string, args: string[], cwd: string = repoRoot): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export interface LockfileDepInfo {
  specifier: string;
  version: string;
}

export interface LockfileImporter {
  dependencies?: Record<string, LockfileDepInfo>;
  devDependencies?: Record<string, LockfileDepInfo>;
  peerDependencies?: Record<string, LockfileDepInfo>;
  optionalDependencies?: Record<string, LockfileDepInfo>;
}

export interface LockfilePackage {
  resolution?: { integrity?: string; tarball?: string };
}

export interface LockfileSnapshot {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface Lockfile {
  lockfileVersion?: string;
  importers?: Record<string, LockfileImporter>;
  packages?: Record<string, LockfilePackage>;
  snapshots?: Record<string, LockfileSnapshot>;
  settings?: Record<string, unknown>;
}

export function loadLockfile(): Lockfile {
  // pnpm writes the lockfile as a multi-document YAML stream; the document that
  // carries the workspace importers and settings is the authoritative one.
  const docs = YAML.parseAllDocuments(
    readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8"),
  ).map((doc) => doc.toJSON() as Lockfile | null);
  const main = docs
    .filter((d): d is Lockfile => d !== null)
    .sort((a, b) => Object.keys(b.importers ?? {}).length - Object.keys(a.importers ?? {}).length)[0];
  if (!main) throw new Error("pnpm-lock.yaml: no main lockfile document found");
  return main;
}

export function workspacePackageDirs(): string[] {
  const dirs: string[] = [];
  for (const group of ["apps", "packages", "tooling"]) {
    const base = path.join(repoRoot, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(path.join(base, entry.name, "package.json"))) {
        dirs.push(path.join(base, entry.name));
      }
    }
  }
  dirs.push(repoRoot);
  return dirs;
}

export interface PackageJson {
  name: string;
  version?: string;
  private?: boolean;
  type?: string;
  packageManager?: string;
  exports?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export function loadPackageJson(dir: string): PackageJson {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as PackageJson;
}

export interface DeclaredDep {
  name: string;
  spec: string;
  field: string;
  dir: string;
}

/** All dependency specifiers across every workspace package.json. */
export function declaredDependencies(): DeclaredDep[] {
  const out: DeclaredDep[] = [];
  for (const dir of workspacePackageDirs()) {
    const pkg = loadPackageJson(dir);
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
      for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
        out.push({ name, spec, field, dir: path.relative(repoRoot, dir) || "." });
      }
    }
  }
  return out;
}

export interface ResolvedPackage {
  key: string;
  name: string;
  version: string;
  integrity: string | null;
  tarball: string | null;
}

/** Resolved packages section of pnpm-lock.yaml. */
export function resolvedPackages(lockfile: Lockfile): ResolvedPackage[] {
  const rows: ResolvedPackage[] = [];
  for (const [key, meta] of Object.entries(lockfile.packages ?? {})) {
    const at = key.lastIndexOf("@");
    rows.push({
      key,
      name: key.slice(0, at),
      version: key.slice(at + 1),
      integrity: meta.resolution?.integrity ?? null,
      tarball: meta.resolution?.tarball ?? null,
    });
  }
  return rows;
}

export interface LicenseItem {
  name: string;
  versions?: string[];
  paths?: string[];
  license: string;
  author?: string;
  homepage?: string;
}

export function licenseReport(): Record<string, LicenseItem[]> {
  const raw = run("pnpm", ["licenses", "list", "--json"]);
  return JSON.parse(raw) as Record<string, LicenseItem[]>;
}

export function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
