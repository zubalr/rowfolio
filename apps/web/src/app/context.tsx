import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { I18n, LocaleState } from '@rowfolio/i18n';
import type { SessionController } from './controller.ts';
import type { SessionState } from './state.ts';
import type { BlobUrlStore } from './blobUrls.ts';

export interface AppServices {
  controller: SessionController;
  i18n: I18n;
  blobStore: BlobUrlStore;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesProvider missing');
  return services;
}

export function useSessionState(): SessionState {
  const { controller } = useServices();
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
    () => controller.getState(),
  );
}

export function useI18n(): I18n {
  return useServices().i18n;
}

export function useLocaleState(): LocaleState {
  const { i18n } = useServices();
  return useSyncExternalStore(
    (listener) => i18n.subscribe(listener),
    () => i18n.getState(),
    () => i18n.getState(),
  );
}
