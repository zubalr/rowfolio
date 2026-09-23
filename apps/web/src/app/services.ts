import type { I18n } from '@rowfolio/i18n';
import type { SessionController } from './controller.ts';
import { BlobUrlStore } from './blobUrls.ts';
import type { AppServices } from './context.tsx';

/**
 * Boot locale from the URL: `/ar` and `/ar/…` are Arabic, everything else is
 * English. The route is the locale of record — a stored preference must
 * never override it, or content and URL diverge.
 */
export function bootLocaleFromPath(pathname: string, documentLang?: string): 'ar' | 'en' {
  return documentLang === 'ar' || pathname === '/ar' || pathname.startsWith('/ar/')
    ? 'ar'
    : 'en';
}

/**
 * Composition root — the one place concrete adapters meet. `document`/`window`
 * are injected so the same composition is testable under node.
 *
 * Everything heavy is behind dynamic imports so the landing entry chunk stays
 * inside its bundle budget: the i18n package value-imports @rowfolio/contracts
 * (validator + every shipped schema, both locale catalogs), and the session
 * controller drags the worker protocol. Both load in parallel at boot and the
 * shell suspends on `i18nReady` / `controllerReady` — accessors throw before
 * resolution rather than serving a half-constructed service.
 */
export function createAppServices(options?: {
  storage?: Storage | null;
  fetchSample?: (url: string) => Promise<Response>;
  onDiagnostic?: (msg: string) => void;
}): AppServices {
  // An explicit locale is ALWAYS passed — letting the stored preference win
  // on `/` renders Arabic content under an English route (the stored choice
  // only mirrors the path the toggle navigated to).
  const bootLocale =
    typeof document !== 'undefined'
      ? bootLocaleFromPath(window.location.pathname, document.documentElement.lang)
      : 'en';
  const storage = options?.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const blobStore = new BlobUrlStore();

  let resolvedI18n: I18n | null = null;
  const i18nReady: Promise<I18n> = import('@rowfolio/i18n').then((mod) => {
    // Path beats stored preference so content and route can never diverge;
    // the stored digit preference still applies.
    resolvedI18n = mod.createI18n({
      ...(bootLocale ? { locale: bootLocale } : {}),
      storage,
    });
    return resolvedI18n;
  });

  let resolvedController: SessionController | null = null;
  const controllerReady: Promise<SessionController> = Promise.all([
    import('./controller.ts'),
    i18nReady,
  ]).then(([mod]) => {
    const i18n = resolvedI18n as I18n;
    resolvedController = new mod.SessionController({
      blobStore,
      ...(options?.fetchSample ? { fetchSample: options.fetchSample } : {}),
      ...(options?.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
      locale: () => ({ locale: i18n.getState().locale, numberingSystem: i18n.getState().numberingSystem }),
    });
    return resolvedController;
  });

  return {
    blobStore,
    i18nReady,
    controllerReady,
    get i18n(): I18n {
      if (!resolvedI18n) {
        throw new Error('I18n accessed before i18nReady resolved');
      }
      return resolvedI18n;
    },
    get controller(): SessionController {
      if (!resolvedController) {
        throw new Error('SessionController accessed before controllerReady resolved');
      }
      return resolvedController;
    },
  };
}
