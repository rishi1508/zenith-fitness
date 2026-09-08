import { useEffect, useState, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

export type ConnectionState =
  | 'unknown'     // first render before the probe runs
  | 'online'      // Firestore reachable + browser says online
  | 'offline-browser' // browser navigator.onLine === false
  | 'offline-firestore'; // browser online but Firestore write blocked

/**
 * Source-of-truth for the app's network state. Two signals combined:
 *   - navigator.onLine (fast but unreliable on desktops / captive portals)
 *   - a lightweight read of shared/exerciseLibrary (authoritative)
 *
 * Returns the state plus a retry() function the UI can bind to a "Retry"
 * button. Safe to call from any component; auto-refreshes on
 * online/offline window events.
 */
/** Per-attempt budget. Generous on purpose: a cold Firestore channel on
 *  mobile data is routinely slower than a warm one. */
const PROBE_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 800;

/**
 * One reachability check. `true` means the request got an answer from
 * Firestore — including a permission error, which proves we reached the
 * server even though auth had not settled yet.
 */
async function reachable(timeoutMs: number): Promise<boolean> {
  try {
    await Promise.race([
      getDoc(doc(db, 'shared', 'exerciseLibrary')),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    return true;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    return code === 'permission-denied' || code === 'unauthenticated';
  }
}

export function useOnlineStatus() {
  const [state, setState] = useState<ConnectionState>('unknown');

  const probe = useCallback(async (): Promise<ConnectionState> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 'offline-browser';
    }
    // Two attempts before we ever say "offline". The first read of the app's
    // lifetime has to open a Firestore channel and wait for the auth token, so
    // on a cold start over mobile data it regularly took longer than the old
    // 4 s budget — which is why the gate greeted the user on almost every
    // launch and then vanished when they pressed Try again.
    if (await reachable(PROBE_TIMEOUT_MS)) return 'online';
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline-browser';
    return (await reachable(PROBE_TIMEOUT_MS)) ? 'online' : 'offline-firestore';
  }, []);

  const retry = useCallback(async () => {
    setState('unknown');
    const next = await probe();
    setState(next);
    return next;
  }, [probe]);

  useEffect(() => {
    let cancelled = false;
    probe().then((s) => { if (!cancelled) setState(s); });
    const markOnline = () => { probe().then((s) => { if (!cancelled) setState(s); }); };
    const markOffline = () => { if (!cancelled) setState('offline-browser'); };
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, [probe]);

  return { state, retry };
}
