/**
 * Machine-readable pipeline report: checks plus produced artifact paths
 * and hashes. Written outside the repository (tests never pollute the
 * checkout): `ROWFOLIO_PIPELINE_OUT` or the OS temporary directory.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export interface ReportCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ReportArtifact {
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export function outDir(): string {
  return process.env['ROWFOLIO_PIPELINE_OUT'] ?? join(tmpdir(), 'rowfolio-pipeline');
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function writeArtifact(name: string, bytes: Uint8Array): ReportArtifact {
  const dir = outDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return { name, path, sha256: sha256Hex(bytes), bytes: bytes.byteLength };
}

export function writeReport(checks: ReportCheck[], artifacts: ReportArtifact[]): string {
  const dir = outDir();
  mkdirSync(dir, { recursive: true });
  const report = {
    suite: 'rowfolio pipeline hardening',
    createdAt: new Date().toISOString(),
    passed: checks.filter((c) => c.passed).length,
    failed: checks.filter((c) => !c.passed).length,
    checks,
    artifacts,
  };
  const path = join(dir, 'report.json');
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}
