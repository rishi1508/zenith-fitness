import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Gym, GymMember, GymRole } from '../types';
import { useAuth } from '../auth/AuthContext';
import { getMyGymContext, listenToGym, listenToMyMembership } from '../gymService';

/**
 * Gym OS lite (Tier A) membership context. Loads the cached
 * `GymContext` pointer from the signed-in user's profile, then
 * subscribes to the gym doc and the caller's own membership doc (the
 * only two Firestore listeners this opens, per the spec's cost
 * discipline). Guests and signed-out users always see `gym: null`.
 *
 * See docs/GYM_TIER_A_SPEC.md §6.1.
 */
interface GymContextValue {
  gym: Gym | null;
  membership: GymMember | null;
  role: GymRole | null;
  loading: boolean;
  /** Re-reads the profile's gym pointer — call after joining/leaving/creating a gym. */
  refresh: () => void;
}

const GymCtx = createContext<GymContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useGym(): GymContextValue {
  const ctx = useContext(GymCtx);
  if (!ctx) throw new Error('useGym must be used within GymProvider');
  return ctx;
}

export function GymProvider({ children }: { children: ReactNode }) {
  const { user, isGuest } = useAuth();
  const [gymId, setGymId] = useState<string | null>(null);
  const [gym, setGym] = useState<Gym | null>(null);
  const [membership, setMembership] = useState<GymMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  // Load the cached gym pointer from the profile whenever the signed-in
  // user changes (or a caller asks for a refresh, e.g. right after
  // joining/leaving/creating a gym). The whole body runs inside an
  // async callback (rather than calling setState synchronously from the
  // effect's top level) so a guest/signed-out reset is just another
  // resolved branch, not a special-cased early return.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user || isGuest) {
        if (!cancelled) { setGymId(null); setLoading(false); }
        return;
      }
      if (!cancelled) setLoading(true);
      try {
        const ctx = await getMyGymContext();
        if (!cancelled) setGymId(ctx?.gymId ?? null);
      } catch (err) {
        console.warn('[Gym] failed to load gym context:', err);
        if (!cancelled) setGymId(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, isGuest, refreshTick]);

  // Subscribe to the gym doc + my membership doc once we know which gym.
  useEffect(() => {
    if (!gymId) {
      const reset = () => { setGym(null); setMembership(null); };
      reset();
      return;
    }
    const unsubGym = listenToGym(gymId, setGym);
    const unsubMembership = listenToMyMembership(gymId, setMembership);
    return () => { unsubGym(); unsubMembership(); };
  }, [gymId]);

  // Apply the gym's accent colour as the global --accent CSS var while
  // it's set; restore the default the moment it's unset or we leave.
  useEffect(() => {
    const root = document.documentElement;
    if (gym?.accentColor) {
      root.style.setProperty('--accent', gym.accentColor);
    } else {
      root.style.removeProperty('--accent');
    }
    return () => { root.style.removeProperty('--accent'); };
  }, [gym?.accentColor]);

  const role = membership?.role ?? null;

  return (
    <GymCtx.Provider value={{ gym, membership, role, loading, refresh }}>
      {children}
    </GymCtx.Provider>
  );
}
