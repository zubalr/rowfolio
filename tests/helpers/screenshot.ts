/**
 * Screenshot + evidence-metadata capture for Playwright tests.
 *
 * Every evidence PNG gets a deterministic sidecar `.meta.json` carrying
 * the sha256, byte size, viewport, locale direction, reduced-motion and
 * color-scheme state, the git commit under test and the tool versions —
 * so a screenshot in a PR is reproducible evidence, not a vibe. The
 * sidecar/manifest generation is pure and unit-tested here; the actual
 * page.screenshot call is exercised by the e2e suite.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_VERSION } from '../../packages/contracts/src/index.ts';
import { ARTIFACTS_DIR, gitHeadSha } from './repo.ts';

export interface ShotMeta {
  /** Logical evidence name, e.g. "brief-en-desktop". */
  name: string;
  /** PNG filename (relative to the shots dir). */
  file: string;
  sha256: string;
  bytes: number;
  viewport: { width: number; height: number };
  locale: 'en' | 'ar';
  direction: 'ltr' | 'rtl';
  reducedMotion: boolean;
  colorScheme: 'light' | 'dark';
  commit: string;
  contractVersion: string;
  node: string;
  capturedAt: string | null;
}

export interface CaptureContext {
  locale: 'en' | 'ar';
  reducedMotion?: boolean;
  colorScheme?: 'light' | 'dark';
  /** Defaults to artifacts/screenshots. */
  outDir?: string;
  /** Deterministic runs may pin a timestamp; default null (no clock in output). */
  capturedAt?: string | null;
}

export function shotsDir(outDir?: string): string {
  const dir = outDir ?? join(ARTIFACTS_DIR, 'screenshots');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function pngFileName(name: string): string {
  const safe = name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  return `${safe}.png`;
}

export function sidecarName(pngFile: string): string {
  return pngFile.replace(/\.png$/, '.meta.json');
}

/** Build the metadata record for an already-captured PNG. */
export function shotMeta(name: string, pngBytes: Uint8Array, ctx: CaptureContext & { viewport: { width: number; height: number } }): ShotMeta {
  return {
    name,
    file: pngFileName(name),
    sha256: createHash('sha256').update(pngBytes).digest('hex'),
    bytes: pngBytes.byteLength,
    viewport: ctx.viewport,
    locale: ctx.locale,
    direction: ctx.locale === 'ar' ? 'rtl' : 'ltr',
    reducedMotion: ctx.reducedMotion ?? false,
    colorScheme: ctx.colorScheme ?? 'light',
    commit: gitHeadSha(),
    contractVersion: CONTRACT_VERSION,
    node: process.version,
    capturedAt: ctx.capturedAt ?? null,
  };
}

/** Sorted, deterministic manifest of a set of shots. */
export function shotsManifest(metas: readonly ShotMeta[]): { schemaVersion: string; shots: ShotMeta[] } {
  return {
    schemaVersion: '1.0.0',
    shots: [...metas].sort((a, b) => a.file.localeCompare(b.file)),
  };
}

export function writeShot(metasDir: string, meta: ShotMeta, pngBytes: Uint8Array): { pngPath: string; metaPath: string } {
  const pngPath = join(metasDir, meta.file);
  writeFileSync(pngPath, pngBytes);
  const metaPath = join(metasDir, sidecarName(meta.file));
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  return { pngPath, metaPath };
}

/**
 * Playwright glue: take a screenshot + sidecar in one call.
 * `page` is typed loosely so vitest can import this module without the
 * playwright dependency.
 */
export async function captureEvidenceShot(
  page: { screenshot(opts: { type: 'png' }): Promise<Uint8Array>; viewportSize(): { width: number; height: number } | null },
  name: string,
  ctx: CaptureContext,
): Promise<ShotMeta> {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const png = await page.screenshot({ type: 'png' });
  const meta = shotMeta(name, png, { ...ctx, viewport });
  writeShot(shotsDir(ctx.outDir), meta, png);
  return meta;
}
