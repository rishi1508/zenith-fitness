import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Gym, GymMember, GymRole } from '../types';
import { useAuth } from '../auth/AuthContext';
import { getMyGymContext, listenToGym, listenToMyMembership, listenToAnnouncements } from '../gymService';
import { startGymLibrarySync } from '../gymLibrary';
import { readHint, writeHint, type GymHint } from './gymHint';
import { announcementsSeenKey, readAnnouncementsSeen } from './announcementsSeen';

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
  /** Notices posted since this device last opened the Announcements tab (0–25). */
  unseenAnnouncements: number;
  /** Looking at the tab is what marks them seen — on this device only. */
  markAnnouncementsSeen: () => void;
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
  const [noticeTimes, setNoticeTimes] = useState<string[]>([]);
  const [seenNotice, setSeenNotice] = useState('');
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

  /**
   * Subscribe to the gym doc + my membership doc once we know which gym AND
   * who is asking.
   *
   * `user` is in the deps for a reason: the gym id is now seeded from the
   * device hint on the very first render, before auth has resolved, and
   * `listenToMyMembership` returns a no-op when there is no signed-in user.
   * Without re-running when auth lands, membership stayed null forever —
   * "Loading your membership…", and no role, so the Manage segment
   * disappeared for owners and admins too (reported 2026-09-10).
   */
  useEffect(() => {
    if (!gymId || !user || isGuest) {
      setGym(null);
      setMembership(null);
      return;
    }
    const unsubGym = listenToGym(gymId, setGym);
    const unsubMembership = listenToMyMembership(gymId, setMembership);
    // The gym's exercise library feeds the pickers and the workout screen
    // (src/gymLibrary.ts) — one small listener, cleared on leaving.
    const unsubLibrary = startGymLibrarySync(gymId);
    // The 25 newest notices' timestamps, for the unseen count on the tab.
    setSeenNotice(readAnnouncementsSeen(gymId));
    const unsubNotices = listenToAnnouncements(gymId, (rows) => setNoticeTimes(rows.map((a) => a.at)), 25);
    return () => { unsubGym(); unsubMembership(); unsubLibrary(); unsubNotices(); setNoticeTimes([]); };
  }, [gymId, user, isGuest]);

  const unseenAnnouncements = noticeTimes.filter((at) => at > seenNotice).length;
  const markAnnouncementsSeen = useCallback(() => {
    if (!gymId) return;
    const newest = noticeTimes[0];
    if (!newest || newest <= seenNotice) return;
    try { localStorage.setItem(announcementsSeenKey(gymId), newest); } catch { /* quota */ }
    setSeenNotice(newest);
  }, [gymId, noticeTimes, seenNotice]);

  // Remember the gym for the next launch, so the shell never has to guess.
  useEffect(() => {
    if (!user || isGuest) return;
    if (gym) {
      const next: GymHint = { uid: user.uid, gymId: gym.id, gymName: gym.name, ...(gym.accentColor ? { accentColor: gym.accentColor } : {}) };
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

  // The rules gate staff actions on gyms/{id}.staff and ownerUid, so that
  // is what decides the role here too; the member doc's copy is the
  // fallback (it is what a plain member has).
  const uid = user?.uid;
  const role: GymRole | null = !gym || !uid
    ? (membership?.role ?? null)
    : gym.ownerUid === uid ? 'owner' : (gym.staff?.[uid] ?? membership?.role ?? null);

  return (
    <GymCtx.Provider value={{ gym, membership, role, loading, hasGymHint: !!hint, refresh, unseenAnnouncements, markAnnouncementsSeen }}>
      {children}
    </GymCtx.Provider>
  );
}
