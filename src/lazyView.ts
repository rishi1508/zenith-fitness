import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * `React.lazy` for a named export. Keeps the component's prop types, so
 * `<LazySettingsView isDark />` is still type-checked. Each call site's
 * `import()` becomes its own Vite chunk, downloaded the first time the view
 * is rendered (and cached by the service worker afterwards).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(
  loader: () => Promise<M>,
  key: K,
): LazyExoticComponent<M[K]> {
  return lazy(() => loader().then((m) => ({ default: m[key] })));
}
