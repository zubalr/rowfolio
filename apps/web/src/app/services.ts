import { createI18n, type I18n } from '@rowfolio/i18n';
import type { SessionController } from './controller.ts';
import { BlobUrlStore } from './blobUrls.ts';
import type { AppServices } from './context.tsx';

/**
 * Composition root — the one place concrete adapters meet. `document`/`window`
 * are injected so the same composition is testable under node.
 *
 * The landing needs only i18n: the session controller (which drags the worker
 * protocol, transport and contract schemas) is created behind a dynamic import
 * so none of it ships in the landing entry chunk. Consumers gate on
 * `controllerReady` — `services.controller` throws before resolution rather
 * than serving a half-constructed session.
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
  let resolved: SessionController | null = null;
  const controllerReady: Promise<SessionController> = import('./controller.ts').then((mod) => {
    resolved = new mod.SessionController({
      blobStore,
      ...(options?.fetchSample ? { fetchSample: options.fetchSample } : {}),
      ...(options?.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
      locale: () => ({ locale: i18n.getState().locale, numberingSystem: i18n.getState().numberingSystem }),
    });
    return resolved;
  });
  return {
    i18n,
    blobStore,
    controllerReady,
    get controller(): SessionController {
      if (!resolved) {
        throw new Error('SessionController accessed before controllerReady resolved');
      }
      return resolved;
    },
  };
}
