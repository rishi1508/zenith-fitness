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
export function useOnlineStatus() {
  const [state, setState] = useState<ConnectionState>('unknown');

  const probe = useCallback(async (): Promise<ConnectionState> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 'offline-browser';
    }
    try {
      // shared/exerciseLibrary is readable by any signed-in user; using
      // it as a heartbeat avoids creating a dedicated ping doc.
      await Promise.race([
        getDoc(doc(db, 'shared', 'exerciseLibrary')),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
      ]);
      return 'online';
    } catch (err) {
      // permission-denied / unauthenticated means the request REACHED
      // Firestore (so we have connectivity) but our identity wasn't
      // accepted — typically because auth is still settling on app
      // launch. Treat that as 'online' so the false "you look offline"
      // modal stops firing on every login. Real network failures throw
      // different errors (timeout, fetch abort, no .code property) and
      // correctly fall through to 'offline-firestore'.
      const code = (err as { code?: string } | null)?.code;
      if (code === 'permission-denied' || code === 'unauthenticated') {
        return 'online';
      }
      return 'offline-firestore';
    }
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
