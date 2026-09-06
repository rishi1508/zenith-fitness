import { useEffect, useState } from 'react';
import type { GymMember, DashboardStats } from '../types';
import { listMembers, listDailyStats, listPayments, listClasses, computeDashboard } from '../gymService';
import { listSessions } from '../gymStaffHelpers';
import { localDateISO, addDaysISO } from '../gymStats';

interface GymDashboardState {
  members: GymMember[];
  stats: DashboardStats | null;
  loading: boolean;
  error: string | null;
  /** Bump to re-run the load (e.g. a manual refresh button). */
  refresh: () => void;
}

/**
 * Owner/manager dashboard data loading — extracted from GymDashboardView
 * (docs/REVAMP_SPEC.md §4) so GymHomeView's Manage segment can show the
 * same aggregates without a second, divergent copy of the fetch +
 * gymStats.computeDashboard wiring. Loads members/dailyStats/payments/
 * classes/sessions once per `gymId` (and on `refresh()`), aggregates
 * client-side. `enabled` gates the fetch (e.g. staff-only, or only while
 * the Manage segment is showing).
 */
export function useGymDashboard(gymId: string | undefined, enabled: boolean): GymDashboardState {
  const [members, setMembers] = useState<GymMember[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!gymId || !enabled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const now = new Date();
        const dailyStatsSinceDate = addDaysISO(localDateISO(now), -29);
        const paymentsSinceISO = new Date(now.getTime() - 90 * 86_400_000).toISOString();
        const sessionsSinceDate = addDaysISO(localDateISO(now), -6);

        const [membersList, dailyStats, payments90d, classes] = await Promise.all([
          listMembers(gymId, { limit: 600 }),
          listDailyStats(gymId, dailyStatsSinceDate),
          listPayments(gymId, { sinceISO: paymentsSinceISO }),
          listClasses(gymId),
        ]);
        const sessions7d = await listSessions(gymId, classes, sessionsSinceDate);
        const computed = computeDashboard({ members: membersList, dailyStats, payments90d, classes, sessions7d, now });
        if (!cancelled) { setMembers(membersList); setStats(computed); }
      } catch (err) {
        console.warn('[GymDashboard] load failed:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gymId, enabled, refreshTick]);

  return { members, stats, loading, error, refresh: () => setRefreshTick((n) => n + 1) };
}
