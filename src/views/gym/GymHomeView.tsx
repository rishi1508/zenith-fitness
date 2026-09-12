import { useEffect, useMemo, useState } from 'react';
import {
  ScanLine, CalendarDays, Megaphone, CreditCard, MonitorSmartphone, Users, ListChecks,
  IndianRupee, AlertTriangle, BarChart3, ClipboardList, PlaySquare, History,
} from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymClass } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { useGymDashboard } from '../../gym/useGymDashboard';
import { listenToClasses, upcomingSessions } from '../../gymService';
import { formatTime12h } from '../../gymMemberHelpers';
import { MembershipCard } from '../../components';
import { JoinGymView } from './JoinGymView';
import { PeakHours } from '../../components/gym/PeakHours';
import { GymFeedView } from './GymFeedView';
import { Card, StatTile, ListRow, Button, SegmentedControl, SectionHeader, SUB } from '../../ui';

type Segment = 'feed' | 'member' | 'manage';

/** Survives the component unmounting while a gym sub-screen is open. */
let lastSegment: Segment = 'feed';

/** Member home: membership card + QR, big Check in button, today's
 *  classes, and quick links — announcements moved under the Feed tab.
 *  Staff (trainer/
 *  manager/owner) get a Member | Manage segmented control (docs/
 *  REVAMP_SPEC.md §4) — Manage reuses `useGymDashboard` for owner/
 *  manager, or a lighter row list for trainers. Renders JoinGymView
 *  inline when the signed-in user has no gym yet. The AppBar (title +
 *  owner gear) is supplied by AppShell, not this view. */
export function GymHomeView(props: GymViewProps) {
  const { isDark, onNavigate } = props;
  const { gym, membership, role, loading } = useGym();
  const { user } = useAuth();

  const [classes, setClasses] = useState<GymClass[] | null>(null);
  // The feed is what a member opens My Gym for on most days; the card, plan
  // and QR are one tap away and rarely change. Remembered across a trip into
  // a pushed screen — coming back from Members used to dump you on Feed.
  const [segment, setSegmentState] = useState<Segment>(() => lastSegment);
  const setSegment = (next: Segment) => { lastSegment = next; setSegmentState(next); };

  useEffect(() => {
    if (!gym?.id) return;
    return listenToClasses(gym.id, setClasses);
  }, [gym?.id]);

  const todaySessions = useMemo(() => upcomingSessions(classes ?? [], new Date(), 1), [classes]);

  if (loading) {
    return <Card className="text-center"><p className={SUB}>Loading your gym…</p></Card>;
  }

  if (!gym) return <JoinGymView {...props} />;

  // A Zenith admin can manage any gym, membership role or not.
  const isStaff = role === 'trainer' || role === 'manager' || role === 'owner' || isAdmin(user?.uid);
  const isManagerPlus = role === 'manager' || role === 'owner' || isAdmin(user?.uid);

  return (
    <div className="space-y-4 animate-fadeIn">
      <SegmentedControl
        label="My Gym section"
        options={[
          { value: 'feed', label: 'Feed' },
          { value: 'member', label: 'Member' },
          ...(isStaff ? [{ value: 'manage' as const, label: 'Manage' }] : []),
        ]}
        value={segment}
        onChange={setSegment}
      />

      {segment === 'feed' ? (
        <GymFeedView onOpenProfile={props.onOpenProfile} />
      ) : segment === 'manage' && isStaff ? (
        <ManageSection isDark={isDark} gym={gym} isManagerPlus={isManagerPlus} onNavigate={onNavigate} />
      ) : (
        <>
          {membership ? (
            <MembershipCard gym={gym} member={membership} isDark={isDark} />
          ) : (
            <Card><p className={SUB}>Loading your membership…</p></Card>
          )}

          <Button variant="primary" size="lg" full icon={ScanLine} onClick={() => onNavigate('gym-checkin')}>
            Check in
          </Button>

          <div className="space-y-2">
            <SectionHeader caption="Today's classes" />
            {classes === null ? (
              <p className={SUB}>Loading…</p>
            ) : todaySessions.length === 0 ? (
              <p className={SUB}>No classes today.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {todaySessions.map(({ cls, date }) => (
                  <button
                    key={cls.id}
                    onClick={() => onNavigate('gym-class', { classId: `${cls.id}|${date}` })}
                    className="shrink-0 min-w-[150px] rounded-card border border-border bg-surface p-3 text-left"
                  >
                    <div className="text-sm font-semibold truncate text-text">{cls.name}</div>
                    <div className={`text-xs mt-0.5 ${SUB}`}>{formatTime12h(cls.startTime)} · {cls.durationMin}m</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Card padding="list">
            <ListRow icon={CalendarDays} title="Classes" onClick={() => onNavigate('gym-classes')} />
            <ListRow icon={ClipboardList} title="Workout plans" subtitle={`Programmes from ${gym.name}`} onClick={() => onNavigate('gym-plans')} />
            <ListRow icon={PlaySquare} title="Exercise videos" subtitle="How your trainers want each movement done" onClick={() => onNavigate('gym-library')} />
            <ListRow icon={CreditCard} title="Membership" onClick={() => onNavigate('gym-membership')} />
          </Card>
        </>
      )}
    </div>
  );
}

interface ManageSectionProps {
  isDark: boolean;
  gym: NonNullable<ReturnType<typeof useGym>['gym']>;
  isManagerPlus: boolean;
  onNavigate: GymViewProps['onNavigate'];
}

/** Manage segment (staff). Owner/manager get the dashboard aggregates
 *  via `useGymDashboard`; trainers get a lighter row list (console,
 *  attendance, read-only members). */
function ManageSection({ gym, isDark, isManagerPlus, onNavigate }: ManageSectionProps) {
  const { stats, loading } = useGymDashboard(gym.id, isManagerPlus);

  if (!isManagerPlus) {
    return (
      <Card padding="list">
        <ListRow icon={MonitorSmartphone} title="Check-in console" onClick={() => onNavigate('gym-console')} />
        <ListRow icon={CalendarDays} title="Classes" subtitle="Attendance" onClick={() => onNavigate('gym-classes-manage')} />
        <ListRow icon={Megaphone} title="Announcements" subtitle="Post to every member" onClick={() => onNavigate('gym-announcements')} />
        <ListRow icon={PlaySquare} title="Exercise videos" subtitle="Add and edit movements" onClick={() => onNavigate('gym-library')} />
        <ListRow icon={ClipboardList} title="Workout plans" subtitle="Publish and manage" onClick={() => onNavigate('gym-plans')} />
        <ListRow icon={Users} title="Members" subtitle="Read-only" onClick={() => onNavigate('gym-members')} />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {loading && !stats ? (
        <Card><p className={SUB}>Loading dashboard…</p></Card>
      ) : stats ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatTile eyebrow="Active" value={stats.activeMembers} compact />
            <StatTile eyebrow="In today" value={stats.checkinsToday} compact tone="ok" />
            <StatTile eyebrow="Dues" value={stats.duesOutstanding.length} compact tone={stats.duesOutstanding.length > 0 ? 'danger' : 'default'} />
          </div>

          {/* The same scrubbable chart the dashboard uses — this copy was a
              static one, which is why holding it did nothing. */}
          <PeakHours counts={stats.checkinsPerHour} isDark={isDark} />

          <Card padding="list">
            <ListRow icon={BarChart3} title="Analytics" subtitle="Revenue, churn, slipping members, floor" onClick={() => onNavigate('gym-ops')} />
            <ListRow icon={History} title="Activity" subtitle="Who did what, when" onClick={() => onNavigate('gym-activity')} />
            <ListRow icon={Users} title="Members" subtitle={`${stats.expiringIn7} expiring this week`} onClick={() => onNavigate('gym-members')} />
            <ListRow icon={MonitorSmartphone} title="Check-in console" subtitle="Today's code · scan · manual" onClick={() => onNavigate('gym-console')} />
            <ListRow icon={ListChecks} title="Classes" onClick={() => onNavigate('gym-classes-manage')} />
            <ListRow icon={Megaphone} title="Announcements" subtitle="Post to every member" onClick={() => onNavigate('gym-announcements')} />
            <ListRow icon={PlaySquare} title="Exercise videos" subtitle="Add and edit movements" onClick={() => onNavigate('gym-library')} />
            <ListRow icon={ClipboardList} title="Workout plans" subtitle="Publish and manage" onClick={() => onNavigate('gym-plans')} />
            <ListRow
              icon={IndianRupee}
              title="Payments"
              subtitle={`₹${stats.revenue30d.toLocaleString('en-IN')} · 30 days`}
              onClick={() => onNavigate('gym-members', { membersFilter: 'expired' })}
            />
          </Card>

          <div className="space-y-2">
            <SectionHeader caption={`At risk · no visit in 14 days (${stats.atRisk.length})`} trailing={{ label: 'All', onClick: () => onNavigate('gym-dashboard') }} />
            {stats.atRisk.length === 0 ? (
              <p className={SUB}>No at-risk members right now.</p>
            ) : (
              <Card padding="list">
                {stats.atRisk.slice(0, 3).map((m) => (
                  <ListRow key={m.uid} icon={AlertTriangle} iconTone="danger" title={m.name} onClick={() => onNavigate('gym-member', { memberUid: m.uid })} />
                ))}
              </Card>
            )}
          </div>
        </>
      ) : (
        <Card><p className={SUB}>Couldn't load the dashboard.</p></Card>
      )}
    </div>
  );
}
