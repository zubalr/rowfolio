import { createI18n, type I18n } from '@rowfolio/i18n';
import { SessionController } from './controller.ts';
import { BlobUrlStore } from './blobUrls.ts';
import type { AppServices } from './context.tsx';

/**
 * Composition root — the one place concrete adapters meet. `document`/`window`
 * are injected so the same composition is testable under node.
 */
export function createAppServices(options?: {
  storage?: Storage | null;
  fetchSample?: (url: string) => Promise<Response>;
  onDiagnostic?: (msg: string) => void;
}): AppServices {
  const bootLocale =
    typeof document !== 'undefined' && document.documentElement.lang === 'ar' ? 'ar' : undefined;
  const i18n: I18n = createI18n({
    // The MPA entry's <html lang> declares the boot locale; the provider's
    // stored preference wins when present.
    ...(bootLocale ? { locale: bootLocale } : {}),
    storage: options?.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null),
  });
  const blobStore = new BlobUrlStore();
  const controller = new SessionController({
    blobStore,
    ...(options?.fetchSample ? { fetchSample: options.fetchSample } : {}),
    ...(options?.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
    locale: () => ({ locale: i18n.getState().locale, numberingSystem: i18n.getState().numberingSystem }),
  });
  return { controller, i18n, blobStore };
}
