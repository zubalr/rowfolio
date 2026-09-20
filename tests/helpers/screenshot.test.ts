/**
 * Self-tests for screenshot evidence metadata: deterministic file names,
 * sha256/byte accounting, RTL direction derivation, sorted manifests, and
 * an end-to-end write into the artifacts dir.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '../../packages/contracts/src/index.ts';
import { ensureArtifactsDir, gitHeadSha, sha256Of } from './index.ts';
import { pngFileName, shotMeta, shotsManifest, sidecarName, writeShot } from './screenshot.ts';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OUT = 'screenshots-test';

afterEach(() => {
  rmSync(join(ensureArtifactsDir(), OUT), { recursive: true, force: true });
});

describe('shotMeta', () => {
  it('captures hash, viewport, direction, commit and contract version', () => {
    const m = shotMeta('Brief AR — Mobile', PNG_BYTES, {
      viewport: { width: 390, height: 844 },
      locale: 'ar',
      reducedMotion: true,
    });
    expect(m.file).toBe('brief-ar-mobile.png');
    expect(m.sha256).toBe(sha256Of(PNG_BYTES));
    expect(m.bytes).toBe(PNG_BYTES.byteLength);
    expect(m.direction).toBe('rtl');
    expect(m.reducedMotion).toBe(true);
    expect(m.commit).toBe(gitHeadSha());
    expect(m.contractVersion).toBe(CONTRACT_VERSION);
    expect(m.capturedAt).toBeNull();
  });

  it('en locale → ltr, light theme default', () => {
    const m = shotMeta('x', PNG_BYTES, { viewport: { width: 1, height: 1 }, locale: 'en' });
    expect(m.direction).toBe('ltr');
    expect(m.colorScheme).toBe('light');
    expect(m.reducedMotion).toBe(false);
  });
});

describe('file naming + manifest', () => {
  it('names are filesystem-safe and sidecars pair up', () => {
    expect(pngFileName('a/b c.png')).toBe('a-b-c-png.png');
    expect(sidecarName('shot.png')).toBe('shot.meta.json');
  });

  it('manifest sorts shots by file name deterministically', () => {
    const a = shotMeta('z-last', PNG_BYTES, { viewport: { width: 1, height: 1 }, locale: 'en' });
    const b = shotMeta('a-first', PNG_BYTES, { viewport: { width: 1, height: 1 }, locale: 'en' });
    const m = shotsManifest([a, b]);
    expect(m.schemaVersion).toBe('1.0.0');
    expect(m.shots.map((s) => s.name)).toEqual(['a-first', 'z-last']);
    expect(JSON.stringify(shotsManifest([b, a]))).toBe(JSON.stringify(shotsManifest([a, b])));
  });
});

describe('writeShot', () => {
  it('writes PNG + sidecar into the artifacts dir', () => {
    const dir = ensureArtifactsDir(OUT);
    const meta = shotMeta('evidence', PNG_BYTES, { viewport: { width: 1280, height: 800 }, locale: 'en' });
    const { pngPath, metaPath } = writeShot(dir, meta, PNG_BYTES);
    expect(existsSync(pngPath)).toBe(true);
    const side = JSON.parse(readFileSync(metaPath, 'utf8'));
    expect(side.sha256).toBe(meta.sha256);
    expect(side.file).toBe('evidence.png');
  });
});
