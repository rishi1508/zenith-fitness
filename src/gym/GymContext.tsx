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
  /** True when this device remembers the signed-in user having a gym, before
   *  Firestore has confirmed it. Lets the shell paint the My Gym tab on the
   *  first frame instead of adding it 300 ms later. */
  hasGymHint: boolean;
  /** Re-reads the profile's gym pointer — call after joining/leaving/creating a gym. */
  refresh: () => void;
}

/**
 * What this device last knew about the user's gym. Loading it takes a profile
 * read and a listener, and until those land the tab bar was one item short —
 * so the whole bar, centre button included, jumped ~300 ms after launch.
 */
interface GymHint { uid: string; gymId: string; accentColor?: string }

/** One key, holding the uid too, so the very first render can read it —
 *  before `useAuth` has resolved who is signed in. A hint for a different
 *  account is discarded the moment auth says so. */
const HINT_KEY = 'zenith_gym_hint';

function readHint(): GymHint | null {
  try {
    const raw = localStorage.getItem(HINT_KEY);
    const parsed = raw ? (JSON.parse(raw) as GymHint) : null;
    return parsed?.uid && parsed.gymId ? parsed : null;
  } catch {
    return null;
  }
}

function writeHint(hint: GymHint | null): void {
  try {
    if (hint) localStorage.setItem(HINT_KEY, JSON.stringify(hint));
    else localStorage.removeItem(HINT_KEY);
  } catch { /* private mode */ }
}

const GymCtx = createContext<GymContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useGym(): GymContextValue {
  const ctx = useContext(GymCtx);
  if (!ctx) throw new Error('useGym must be used within GymProvider');
  return ctx;
}

export function GymProvider({ children }: { children: ReactNode }) {
  const { user, isGuest, loading: authLoading } = useAuth();
  // Seeded from the hint so the listeners attach — and the tab appears — on
  // the first frame, then corrected by the profile read below.
  // Seeded synchronously, so the My Gym tab is in the very first paint and
  // the listeners attach a frame earlier too.
  const [hint, setHint] = useState<GymHint | null>(readHint);
  const [gymId, setGymId] = useState<string | null>(() => readHint()?.gymId ?? null);
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
      // Auth has not answered yet: keep the hint. Clearing it here is what
      // made the My Gym tab appear a beat after launch — the provider wiped
      // its own head start before `user` had resolved.
      if (authLoading) return;
      if (!user || isGuest) {
        if (!cancelled) { setGymId(null); setHint(null); writeHint(null); setLoading(false); }
        return;
      }
      // The hint was seeded before auth resolved; keep it only if it belongs
      // to this account.
      const remembered = readHint();
      const mine = remembered?.uid === user.uid ? remembered : null;
      if (!cancelled) {
        setHint(mine);
        if (mine) {
          setGymId((cur) => cur ?? mine.gymId);
          if (mine.accentColor) document.documentElement.style.setProperty('--accent', mine.accentColor);
        } else if (remembered) {
          writeHint(null);
          setGymId(null);
        }
      }
      if (!cancelled) setLoading(true);
      try {
        const ctx = await getMyGymContext();
        if (!cancelled) {
          setGymId(ctx?.gymId ?? null);
          if (!ctx?.gymId) { writeHint(null); setHint(null); }
        }
      } catch (err) {
        console.warn('[Gym] failed to load gym context:', err);
        // Keep the hint on a failed read — offline is not the same as "left".
        if (!cancelled && !mine) setGymId(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, isGuest, authLoading, refreshTick]);

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

  // Remember the gym for the next launch, so the shell never has to guess.
  useEffect(() => {
    if (!user || isGuest) return;
    if (gym) {
      const next: GymHint = { uid: user.uid, gymId: gym.id, ...(gym.accentColor ? { accentColor: gym.accentColor } : {}) };
      writeHint(next);
      setHint(next);
    }
  }, [gym, user, isGuest]);

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
    <GymCtx.Provider value={{ gym, membership, role, loading, hasGymHint: !!hint, refresh }}>
      {children}
    </GymCtx.Provider>
  );
}
