/** Injectable so tests can track create/revoke without a DOM. */
export interface BlobUrlHooks {
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

/**
 * Registry of object URLs handed to download links. Every URL is revoked on
 * `release()` (new export run) and `releaseAll()` (session clear / dispose) —
 * no leaked Blob URLs.
 */
export class BlobUrlStore {
  private readonly urls = new Set<string>();
  private readonly create: (blob: Blob) => string;
  private readonly revoke: (url: string) => void;

  constructor(hooks: BlobUrlHooks = {}) {
    this.create =
      hooks.createObjectURL ??
      ((blob: Blob) => URL.createObjectURL(blob));
    this.revoke =
      hooks.revokeObjectURL ??
      ((url: string) => URL.revokeObjectURL(url));
  }

  register(blob: Blob): string {
    const url = this.create(blob);
    this.urls.add(url);
    return url;
  }

  release(url: string): void {
    if (this.urls.delete(url)) this.revoke(url);
  }

  releaseAll(): void {
    for (const url of this.urls) this.revoke(url);
    this.urls.clear();
  }

  get size(): number {
    return this.urls.size;
  }
}
