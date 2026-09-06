import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Users, CalendarCheck, Clock3, IndianRupee, UserPlus, AlertTriangle } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymMember, DashboardStats } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { listMembers, listCheckins, listPayments, listClasses, computeDashboard, membershipStatus } from '../../gymService';
import { listSessions } from '../../gymStaffHelpers';
import { localDateISO, addDaysISO } from '../../gymStats';
import { InteractiveLineChart } from '../../components';
import { DashboardStatTile } from '../../components/gym/DashboardStatTile';
import { StaffMemberRow } from '../../components/gym/StaffMemberRow';
import { StaffPaymentSheet } from '../../components/gym/StaffPaymentSheet';
import { StaffToast } from '../../components/gym/StaffToast';

const WEEKDAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function lastSeenLabel(m: GymMember): string {
  const last = [m.lastCheckinAt, m.lastWorkoutAt].filter((d): d is string => !!d).sort().pop();
  if (!last) return 'Never checked in';
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
  if (days <= 0) return 'Seen today';
  if (days === 1) return 'Seen 1 day ago';
  return `Seen ${days} days ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Owner/manager staff dashboard — see docs/GYM_TIER_A_SPEC.md §6.3.
 * Loads members/checkins/payments/classes/sessions once on mount (and on
 * refresh), aggregates client-side with gymStats.computeDashboard.
 */
export function GymDashboardView({ isDark, onBack, onNavigate }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const canView = role === 'owner' || role === 'manager' || isAdmin(user?.uid);

  const [members, setMembers] = useState<GymMember[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [paymentTarget, setPaymentTarget] = useState<GymMember | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const gymId = gym?.id;
    if (!gymId || !canView) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const now = new Date();
        const checkinsSinceISO = new Date(now.getTime() - 30 * 86_400_000).toISOString();
        const paymentsSinceISO = new Date(now.getTime() - 90 * 86_400_000).toISOString();
        const sessionsSinceDate = addDaysISO(localDateISO(now), -6);

        const [membersList, checkins30d, payments90d, classes] = await Promise.all([
          listMembers(gymId, { limit: 600 }),
          listCheckins(gymId, { sinceISO: checkinsSinceISO, limit: 5000 }),
          listPayments(gymId, { sinceISO: paymentsSinceISO }),
          listClasses(gymId),
        ]);
        const sessions7d = await listSessions(gymId, classes, sessionsSinceDate);
        const computed = computeDashboard({ members: membersList, checkins30d, payments90d, classes, sessions7d, now });
        if (!cancelled) { setMembers(membersList); setStats(computed); }
      } catch (err) {
        console.warn('[GymDashboard] load failed:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gym?.id, canView, refreshTick]);

  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const cardCls = `rounded-xl border p-4 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`;
  const rowDivider = isDark ? 'divide-[#2e2e2e]' : 'divide-gray-100';

  const expiringSoon = members.filter((m) => membershipStatus(m) === 'expiring');
  const maxHour = stats ? Math.max(1, ...stats.checkinsPerHour) : 1;

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Dashboard</h1>
        </div>
        {canView && (
          <button
            onClick={() => setRefreshTick((n) => n + 1)}
            disabled={loading}
            className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>

      {!canView && (
        <div className={cardCls}>
          <p className={`text-sm ${subtle}`}>Staff only. Ask an owner or manager for dashboard access.</p>
        </div>
      )}

      {canView && loading && !stats && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`rounded-xl border h-24 animate-pulse ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`} />
            ))}
          </div>
          <div className={`rounded-xl border h-40 animate-pulse ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`} />
        </div>
      )}

      {canView && error && (
        <div className={cardCls}>
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      {canView && stats && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <DashboardStatTile icon={Users} label="Active members" value={stats.activeMembers} isDark={isDark} />
            <DashboardStatTile icon={CalendarCheck} label="Checked in today" value={stats.checkinsToday} isDark={isDark} tone="success" />
            <DashboardStatTile icon={Clock3} label="Expiring in 7d" value={stats.expiringIn7} isDark={isDark} tone="warning" />
            <DashboardStatTile icon={AlertTriangle} label="Dues outstanding" value={stats.duesOutstanding.length} isDark={isDark} tone="danger" />
            <DashboardStatTile icon={UserPlus} label="New members (30d)" value={stats.newMembers30d} isDark={isDark} />
            <DashboardStatTile icon={IndianRupee} label="Revenue (30d)" value={`₹${stats.revenue30d.toLocaleString('en-IN')}`} isDark={isDark} tone="success" />
          </div>

          <InteractiveLineChart
            points={stats.checkinsPerDay.map((d) => ({ date: d.date, value: d.count }))}
            isDark={isDark}
            accent="#f97316"
            gradientId="gymCheckins"
            title="Check-ins · last 30 days"
            formatValue={(v) => String(Math.round(v))}
            unit="check-ins"
            emptyMessage="No check-ins in the last 30 days"
            minPoints={1}
          />

          <div className={cardCls}>
            <div className="text-sm font-medium mb-3">Peak hours <span className={subtle}>· last 30 days</span></div>
            <div className="flex items-end gap-0.5 h-20">
              {stats.checkinsPerHour.map((count, hour) => (
                <div key={hour} className="flex-1 h-full flex items-end" title={`${hour}:00 — ${count} check-ins`}>
                  <div
                    className="w-full rounded-sm bg-orange-500/70"
                    style={{ height: `${count > 0 ? Math.max((count / maxHour) * 100, 4) : 2}%` }}
                  />
                </div>
              ))}
            </div>
            <div className={`flex justify-between text-[10px] mt-1 ${subtle}`}>
              <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={cardCls}>
              <div className="text-sm font-medium mb-2">At risk <span className={subtle}>({stats.atRisk.length})</span></div>
              {stats.atRisk.length === 0 ? (
                <p className={`text-sm ${subtle}`}>No at-risk members right now.</p>
              ) : (
                <div className={`divide-y ${rowDivider}`}>
                  {stats.atRisk.map((m) => (
                    <StaffMemberRow
                      key={m.uid}
                      member={m}
                      isDark={isDark}
                      subtitle={lastSeenLabel(m)}
                      onClick={() => onNavigate('gym-member', { memberUid: m.uid })}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className={cardCls}>
              <div className="text-sm font-medium mb-2">Expiring &amp; overdue</div>
              {stats.duesOutstanding.length === 0 && expiringSoon.length === 0 ? (
                <p className={`text-sm ${subtle}`}>Nobody expiring or overdue.</p>
              ) : (
                <div className={`divide-y ${rowDivider}`}>
                  {stats.duesOutstanding.map(({ member, daysOverdue }) => (
                    <StaffMemberRow
                      key={member.uid}
                      member={member}
                      isDark={isDark}
                      subtitle={`${daysOverdue}d overdue`}
                      onClick={() => onNavigate('gym-member', { memberUid: member.uid })}
                      right={
                        <button
                          onClick={(e) => { e.stopPropagation(); setPaymentTarget(member); }}
                          className="text-xs font-medium text-orange-500 whitespace-nowrap"
                        >
                          Record payment
                        </button>
                      }
                    />
                  ))}
                  {expiringSoon.map((member) => (
                    <StaffMemberRow
                      key={member.uid}
                      member={member}
                      isDark={isDark}
                      subtitle={member.planEnd ? `Ends ${formatDate(member.planEnd)}` : undefined}
                      onClick={() => onNavigate('gym-member', { memberUid: member.uid })}
                      right={
                        <button
                          onClick={(e) => { e.stopPropagation(); setPaymentTarget(member); }}
                          className="text-xs font-medium text-orange-500 whitespace-nowrap"
                        >
                          Record payment
                        </button>
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={cardCls}>
            <div className="text-sm font-medium mb-2">Class fill <span className={subtle}>· last 7 days avg</span></div>
            {stats.classFill.length === 0 ? (
              <p className={`text-sm ${subtle}`}>No classes yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={subtle}>
                      <th className="text-left font-medium pb-2">Class</th>
                      <th className="text-right font-medium pb-2">Enrolled</th>
                      <th className="text-right font-medium pb-2">Attended</th>
                      <th className="text-right font-medium pb-2">Capacity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.classFill.map(({ cls, avgEnrolled, avgAttended, capacity }) => (
                      <tr key={cls.id} className={`border-t ${isDark ? 'border-[#2e2e2e]' : 'border-gray-100'}`}>
                        <td className="py-2">
                          {cls.name} <span className={subtle}>· {WEEKDAY_LABEL[cls.weekday]} {cls.startTime}</span>
                        </td>
                        <td className="text-right py-2">{avgEnrolled.toFixed(1)}</td>
                        <td className="text-right py-2">{avgAttended.toFixed(1)}</td>
                        <td className="text-right py-2">{capacity ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {paymentTarget && gym && (
        <StaffPaymentSheet
          isDark={isDark}
          gymId={gym.id}
          member={paymentTarget}
          plans={gym.plans}
          onClose={() => setPaymentTarget(null)}
          onSuccess={() => {
            setPaymentTarget(null);
            setToast('Payment recorded');
            setRefreshTick((n) => n + 1);
          }}
        />
      )}
      <StaffToast message={toast} isDark={isDark} onDismiss={() => setToast(null)} />
    </div>
  );
}
