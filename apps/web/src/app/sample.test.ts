/* eslint-disable no-restricted-imports -- tests read fixture/sample bytes from disk */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadSampleAssets, SampleError } from './sample.ts';
import snapshotFixture from '../../../../tests/contract/fixtures/analysis-snapshot.example.json';
import type { AnalysisSnapshot } from '@rowfolio/contracts';

const SAMPLE_DIR = fileURLToPath(new URL('../../public/sample/', import.meta.url));

function diskFetch(overrides: Record<string, ArrayBuffer | '404' | string> = {}) {
  return async (url: string): Promise<Response> => {
    const rel = url.replace(/^.*?sample\//, '');
    const override = overrides[rel];
    if (override === '404') return new Response(null, { status: 404 });
    if (typeof override === 'string') return new Response(override, { status: 200 });
    if (override) return new Response(override, { status: 200 });
    try {
      const bytes = await readFile(SAMPLE_DIR + rel);
      return new Response(bytes, { status: 200 });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
}

describe('loadSampleAssets', () => {
  it('loads index + workbook and verifies the bound SHA-256', async () => {
    const assets = await loadSampleAssets(diskFetch() as never);
    expect(assets.workbookHash).toBe('f0d6d06e934b1eef01d839d071ec7dcdc6d9d47b58ccf556c4eb44f92adb3f5e');
    expect(assets.parseOptions.selectedSheetId).toBe('S0');
    // prepared snapshot is not shipped yet (status pending-production-engine).
    expect(assets.preparedSnapshot).toBeNull();
  });

  it('rejects tampered workbook bytes (hash mismatch)', async () => {
    const tampered = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer;
    await expect(
      loadSampleAssets(diskFetch({ 'sample_operations.xlsx': tampered }) as never),
    ).rejects.toBeInstanceOf(SampleError);
    await expect(
      loadSampleAssets(diskFetch({ 'sample_operations.xlsx': tampered }) as never),
    ).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
  });

  it('uses a shipped prepared snapshot only when it validates and binds the bytes', async () => {
    const bound = JSON.stringify({ snapshot: snapshotFixture });
    const unbound = JSON.stringify({ snapshot: { ...snapshotFixture, sourceHash: 'deadbeef'.repeat(8) } });
    const indexReady = JSON.stringify({
      schemaVersion: '1.0.0',
      datasetId: 'regional-services-v1',
      assets: {
        workbook: { file: 'sample_operations.xlsx', mime: 'x', sha256: 'f0d6d06e934b1eef01d839d071ec7dcdc6d9d47b58ccf556c4eb44f92adb3f5e', sourceSheet: 'Operations', sourceSheetId: 'S0', headerRow: 1 },
        manifest: { file: 'manifest.json', mime: 'application/json' },
        preparedSnapshot: { file: 'prepared.snapshot.json', mime: 'application/json', status: 'ready' },
      },
    });
    const a = await loadSampleAssets(diskFetch({ 'index.json': indexReady, 'prepared.snapshot.json': bound }) as never);
    expect((a.preparedSnapshot as AnalysisSnapshot | null)?.id).toBe(snapshotFixture.id);

    const b = await loadSampleAssets(diskFetch({ 'index.json': indexReady, 'prepared.snapshot.json': unbound }) as never);
    expect(b.preparedSnapshot).toBeNull(); // wrong sourceHash → ignored, live path stays authoritative
  });
});
