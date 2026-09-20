import { lazy, Suspense, useCallback, useEffect, useSyncExternalStore } from 'react';
import { Status } from '@rowfolio/ui';
import { Landing } from './Landing.tsx';
import { resolveFeatures } from './features.ts';
import { ServicesProvider, useI18n, useSessionState, type AppServices } from './context.tsx';
import { readRoute } from './router.ts';
import type { MessageKey } from '@rowfolio/i18n';

// Workspace (charts + engine-adjacent UI) is a lazy boundary so the landing
// entry chunk stays free of d3/engine code — enforced by audit-static.ts.
const WorkspaceScreen = lazy(() =>
  import('../workspace/WorkspaceScreen.tsx').then((m) => ({ default: m.WorkspaceScreen })),
);

function useHashRoute(): 'landing' | 'workspace' {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener('hashchange', listener);
      return () => window.removeEventListener('hashchange', listener);
    },
    () => readRoute(window.location),
    () => 'landing',
  );
}

function AppShell() {
  const route = useHashRoute();
  const i18n = useI18n();
  const i18nState = useSyncExternalStore(
    (listener) => i18n.subscribe(listener),
    () => i18n.getState(),
    () => i18n.getState(),
  );
  useSessionState(); // subscribe so diagnostics-free rerenders stay fresh

  // Document lang/dir follow the provider (RTL correctness on both entries).
  useEffect(() => {
    const props = i18n.documentProps();
    document.documentElement.lang = props.lang;
    document.documentElement.dir = props.dir;
  }, [i18n, i18nState.locale]);

  // Locale ⇄ URL path sync: `/ar/` ↔ ar. popstate keeps the provider honest.
  useEffect(() => {
    const onPop = () => {
      const ar = window.location.pathname.startsWith('/ar');
      i18n.setLocale(ar ? 'ar' : 'en');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [i18n]);

  const navigateWorkspace = useCallback(() => {
    if (window.location.hash !== '#/workspace') window.location.hash = '#/workspace';
  }, []);

  const navigateLanding = useCallback(() => {
    window.location.hash = '#/';
  }, []);

  if (route === 'landing') {
    const LandingApp = resolveFeatures().LandingApp;
    // The real landing owns its intent/navigation (`{i18n}` only); the
    // built-in fallback covers environments where the slot is absent.
    return LandingApp ? (
      <Suspense fallback={<Status kind="loading" title={i18n.tSafe('a11y.processing' as MessageKey)} />}>
        <LandingApp i18n={i18n} />
      </Suspense>
    ) : (
      <Landing onNavigateWorkspace={navigateWorkspace} />
    );
  }
  return (
    <Suspense fallback={<Status kind="loading" title={i18n.tSafe('a11y.processing' as MessageKey)} />}>
      <WorkspaceScreen navigateLanding={navigateLanding} />
    </Suspense>
  );
}

export function App({ services }: { services: AppServices }) {
  return (
    <ServicesProvider services={services}>
      <AppShell />
    </ServicesProvider>
  );
}
