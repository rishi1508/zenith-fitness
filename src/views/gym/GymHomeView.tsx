import { useEffect, useMemo, useState } from 'react';
import {
  ScanLine, CalendarDays, Megaphone, CreditCard, MonitorSmartphone, Users, ListChecks,
  IndianRupee, AlertTriangle,
} from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymClass, GymAnnouncement } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useGymDashboard } from '../../gym/useGymDashboard';
import { listenToClasses, listenToAnnouncements, upcomingSessions } from '../../gymService';
import { formatTime12h } from '../../gymMemberHelpers';
import { MembershipCard } from '../../components';
import { JoinGymView } from './JoinGymView';
import { GymFeedView } from './GymFeedView';
import { Card, StatTile, ListRow, Button, SegmentedControl, SectionHeader, SUB } from '../../ui';

type Segment = 'member' | 'feed' | 'manage';

/** Member home: membership card + QR, big Check in button, today's
 *  classes, latest announcements, and quick links. Staff (trainer/
 *  manager/owner) get a Member | Manage segmented control (docs/
 *  REVAMP_SPEC.md §4) — Manage reuses `useGymDashboard` for owner/
 *  manager, or a lighter row list for trainers. Renders JoinGymView
 *  inline when the signed-in user has no gym yet. The AppBar (title +
 *  owner gear) is supplied by AppShell, not this view. */
export function GymHomeView(props: GymViewProps) {
  const { isDark, onNavigate } = props;
  const { gym, membership, role, loading } = useGym();

  const [classes, setClasses] = useState<GymClass[] | null>(null);
  const [announcements, setAnnouncements] = useState<GymAnnouncement[] | null>(null);
  const [segment, setSegment] = useState<Segment>('member');

  useEffect(() => {
    if (!gym?.id) return;
    return listenToClasses(gym.id, setClasses);
  }, [gym?.id]);

  useEffect(() => {
    if (!gym?.id) return;
    return listenToAnnouncements(gym.id, setAnnouncements, 3);
  }, [gym?.id]);

  const todaySessions = useMemo(() => upcomingSessions(classes ?? [], new Date(), 1), [classes]);

  if (loading) {
    return <Card className="text-center"><p className={SUB}>Loading your gym…</p></Card>;
  }

  if (!gym) return <JoinGymView {...props} />;

  const isStaff = role === 'trainer' || role === 'manager' || role === 'owner';
  const isManagerPlus = role === 'manager' || role === 'owner';

  return (
    <div className="space-y-4 animate-fadeIn">
      <SegmentedControl
        label="My Gym section"
        options={[
          { value: 'member', label: 'Member' },
          { value: 'feed', label: 'Feed' },
          ...(isStaff ? [{ value: 'manage' as const, label: 'Manage' }] : []),
        ]}
        value={segment}
        onChange={setSegment}
      />

      {segment === 'feed' ? (
        <GymFeedView />
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

          <div className="space-y-2">
            <SectionHeader caption="Announcements" />
            {announcements === null ? (
              <p className={SUB}>Loading…</p>
            ) : announcements.length === 0 ? (
              <p className={SUB}>Nothing posted yet.</p>
            ) : (
              <Card padding="list">
                {announcements.map((a) => (
                  <ListRow key={a.id} icon={Megaphone} title={a.text} subtitle={a.byName} trailing={null} />
                ))}
              </Card>
            )}
          </div>

          <Card padding="list">
            <ListRow icon={CalendarDays} title="Classes" onClick={() => onNavigate('gym-classes')} />
            <ListRow icon={Megaphone} title="Announcements" onClick={() => onNavigate('gym-announcements')} />
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
function ManageSection({ gym, isManagerPlus, onNavigate }: ManageSectionProps) {
  const { stats, loading } = useGymDashboard(gym.id, isManagerPlus);

  if (!isManagerPlus) {
    return (
      <Card padding="list">
        <ListRow icon={MonitorSmartphone} title="Check-in console" onClick={() => onNavigate('gym-console')} />
        <ListRow icon={CalendarDays} title="Classes" subtitle="Attendance" onClick={() => onNavigate('gym-classes-manage')} />
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

          <Card>
            <div className="flex items-center justify-between mb-2">
              <span className={SUB}>Peak hours · 30 days</span>
            </div>
            <div className="flex items-end gap-0.5 h-16">
              {stats.checkinsPerHour.map((count, hour) => {
                const max = Math.max(1, ...stats.checkinsPerHour);
                return (
                  <div key={hour} className="flex-1 h-full flex items-end" title={`${hour}:00 — ${count} check-ins`}>
                    <div className="w-full rounded-sm bg-accent/70" style={{ height: `${count > 0 ? Math.max((count / max) * 100, 4) : 2}%` }} />
                  </div>
                );
              })}
            </div>
          </Card>

          <Card padding="list">
            <ListRow icon={Users} title="Members" subtitle={`${stats.expiringIn7} expiring this week`} onClick={() => onNavigate('gym-members')} />
            <ListRow icon={MonitorSmartphone} title="Check-in console" subtitle="Today's code · scan · manual" onClick={() => onNavigate('gym-console')} />
            <ListRow icon={ListChecks} title="Classes" onClick={() => onNavigate('gym-classes-manage')} />
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
