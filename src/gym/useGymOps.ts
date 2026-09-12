import { useEffect, useState } from 'react';
import type { GymCheckin, GymClass, GymClassSession, GymEquipment, GymMember, GymPayment, GymSessionRating } from '../types';
import { listMembers, listPayments, listCheckins, listClasses, listEquipment } from '../gymService';
import { listSessions } from '../gymStaffHelpers';
import { listRatings } from '../gymRatings';
import { localDateISO, addDaysISO } from '../gymStats';

export interface GymOpsData {
  gymId: string;
  members: GymMember[];
  /** 365 days — the acquisition series and the revenue split share this read. */
  payments: GymPayment[];
  /** 60 days, the two windows the slipping-away index compares. */
  checkins: GymCheckin[];
  classes: GymClass[];
  /** 28 days, matching the four-week trainer window. */
  sessions: GymClassSession[];
  equipment: GymEquipment[];
  /** 30 days of anonymous session ratings (managers only; empty for anyone else). */
  ratings: GymSessionRating[];
  loadedAt: number;
}

interface GymOpsState {
  data: GymOpsData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** A year of payments is the widest read here; 250 members renewing
 *  monthly is well under this, and the cap keeps a runaway gym cheap. */
const PAYMENT_LIMIT = 2000;
/** The ceiling the spec puts on a raw check-in query. Newest first, so a
 *  gym busy enough to exceed it loses the far edge of the earlier window
 *  and under-reports slipping members rather than inventing any. */
const CHECKIN_LIMIT = 5000;
const CACHE_MS = 10 * 60 * 1000;

/**
 * One load per open of the analytics screen, cached for ten minutes per
 * gym. This screen is the most expensive read in the app — 60 days of
 * raw check-ins is thousands of documents — so it must never refetch on
 * a re-render, and the owner gets an explicit refresh instead.
 */
const cache = new Map<string, GymOpsData>();

async function loadGymOps(gymId: string): Promise<GymOpsData> {
  const now = new Date();
  const today = localDateISO(now);
  const [members, payments, checkins, classes, equipment, ratings] = await Promise.all([
    listMembers(gymId, { limit: 600 }),
    listPayments(gymId, { sinceISO: new Date(now.getTime() - 365 * 86_400_000).toISOString(), limit: PAYMENT_LIMIT }),
    listCheckins(gymId, { sinceISO: new Date(now.getTime() - 60 * 86_400_000).toISOString(), limit: CHECKIN_LIMIT }),
    listClasses(gymId),
    // Rules ship separately from code, so a gym whose project has not
    // picked up the equipment rule yet loses that one row, not the screen.
    listEquipment(gymId).catch(() => [] as GymEquipment[]),
    listRatings(gymId, addDaysISO(today, -29)).catch(() => [] as GymSessionRating[]),
  ]);
  // Sessions hang off each class, so this one waits on the class list.
  const sessions = await listSessions(gymId, classes, addDaysISO(today, -27));
  return { gymId, members, payments, checkins, classes, sessions, equipment, ratings, loadedAt: Date.now() };
}

export function useGymOps(gymId: string | undefined, enabled: boolean): GymOpsState {
  const [loaded, setLoaded] = useState<GymOpsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Read the cache during render rather than copying it into state — a
  // second visit inside the window paints with no fetch and no flash.
  const cached = gymId ? cache.get(gymId) ?? null : null;
  const data = loaded?.gymId === gymId ? loaded : cached;

  useEffect(() => {
    if (!gymId || !enabled) return;
    const hit = cache.get(gymId);
    if (refreshTick === 0 && hit && Date.now() - hit.loadedAt < CACHE_MS) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const fresh = await loadGymOps(gymId);
        cache.set(gymId, fresh);
        if (!cancelled) setLoaded(fresh);
      } catch (err) {
        console.warn('[GymOps] load failed:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gymId, enabled, refreshTick]);

  return { data, loading, error, refresh: () => setRefreshTick((n) => n + 1) };
}
