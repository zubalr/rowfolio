import { describe, expect, it } from 'vitest';
import { BlobUrlStore } from './blobUrls.ts';

describe('BlobUrlStore', () => {
  it('registers and revokes URLs; releaseAll clears everything', () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const store = new BlobUrlStore({
      createObjectURL: () => `blob:t-${created.push('x')}`,
      revokeObjectURL: (u) => { revoked.push(u); },
    });
    const a = store.register(new Blob(['a']));
    const b = store.register(new Blob(['b']));
    expect(store.size).toBe(2);
    store.release(a);
    expect(revoked).toEqual([a]);
    store.releaseAll();
    expect(revoked).toEqual([a, b]);
    expect(store.size).toBe(0);
    // idempotent
    store.release(a);
    expect(revoked.length).toBe(2);
  });
});
