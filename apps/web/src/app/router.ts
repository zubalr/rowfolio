export type Route = 'landing' | 'workspace';

export function routeFromHash(hash: string): Route {
  return hash.replace(/^#\/?/, '').startsWith('workspace') ? 'workspace' : 'landing';
}

export function hashForRoute(route: Route): string {
  return route === 'workspace' ? '#/workspace' : '#/';
}

/** Minimal hash router — no dependency; workspace mounts under `#/workspace`. */
export function readRoute(location: { hash: string }): Route {
  return routeFromHash(location.hash);
}
