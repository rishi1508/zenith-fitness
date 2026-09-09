import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { getPermissionState, lastSyncedAt, syncRecentDays } from './healthConnect';

/**
 * Keeps Health Connect data current without the user opening the Activity
 * screen (docs/HEALTH_SPEC.md §4). Steps and sleep feed the energy ledger,
 * so a figure that only refreshed when you visited one screen was wrong
 * everywhere else.
 *
 * Sync happens on launch, whenever the app comes back to the foreground,
 * and on a timer while it is open — each behind the same staleness gate,
 * so bouncing between apps costs one read, not one per bounce.
 */

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const WINDOW_DAYS = 7;

let inFlight: Promise<number> | null = null;

/** Sync at most one at a time, and only when the cache has gone stale. */
export async function syncIfStale(intervalMs = DEFAULT_INTERVAL_MS): Promise<number> {
  if (inFlight) return inFlight;
  const last = lastSyncedAt();
  if (last && Date.now() - new Date(last).getTime() < intervalMs) return 0;
  const state = await getPermissionState();
  if (state !== 'granted' && state !== 'partial') return 0;
  inFlight = syncRecentDays(WINDOW_DAYS).finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Start the background sync. Returns the teardown. Safe to call on a
 * platform without Health Connect: `getPermissionState` reports it and
 * every pass turns into a no-op.
 */
export function startActivityAutoSync(intervalMs = DEFAULT_INTERVAL_MS): () => void {
  let stopped = false;
  const run = () => { if (!stopped) void syncIfStale(intervalMs).catch(() => {}); };

  run();
  const timer = setInterval(run, intervalMs);
  const onVis = () => { if (document.visibilityState === 'visible') run(); };
  document.addEventListener('visibilitychange', onVis);

  let capHandle: PluginListenerHandle | null = null;
  if (Capacitor.isNativePlatform()) {
    CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) run(); })
      .then((h) => { if (stopped) void h.remove(); else capHandle = h; })
      .catch((err) => console.warn('[Activity] appStateChange listener failed:', err));
  }

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVis);
    void capHandle?.remove();
  };
}
