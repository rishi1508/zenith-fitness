import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Building2, ScanLine, CalendarDays, Megaphone, CreditCard, ChevronRight,
  MonitorSmartphone, Users, ListChecks, LayoutDashboard, Settings,
} from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymClass, GymAnnouncement } from '../../types';
import { useGym } from '../../gym/GymContext';
import { listenToClasses, listenToAnnouncements, upcomingSessions } from '../../gymService';
import { formatTime12h } from '../../gymMemberHelpers';
import { MembershipCard } from '../../components';
import { JoinGymView } from './JoinGymView';

/** Member home: gym header, membership card + QR, big Check in button,
 *  today's classes, latest announcements, and quick links. Staff
 *  (trainer/manager/owner) additionally see a Staff section. Renders
 *  JoinGymView inline when the signed-in user has no gym yet. */
export function GymHomeView(props: GymViewProps) {
  const { isDark, onBack, onNavigate } = props;
  const { gym, membership, role, loading } = useGym();

  const [classes, setClasses] = useState<GymClass[] | null>(null);
  const [announcements, setAnnouncements] = useState<GymAnnouncement[] | null>(null);

  useEffect(() => {
    if (!gym?.id) return;
    return listenToClasses(gym.id, setClasses);
  }, [gym?.id]);

  useEffect(() => {
    if (!gym?.id) return;
    return listenToAnnouncements(gym.id, setAnnouncements, 3);
  }, [gym?.id]);

  const todaySessions = useMemo(() => upcomingSessions(classes ?? [], new Date(), 1), [classes]);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  if (loading) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">My Gym</h1>
        </div>
        <div className={`rounded-xl border p-6 text-center text-sm ${cardBg} ${cardBorder} ${subtle}`}>Loading your gym…</div>
      </div>
    );
  }

  if (!gym) return <JoinGymView {...props} />;

  const isStaff = role === 'trainer' || role === 'manager' || role === 'owner';
  const isManagerPlus = role === 'manager' || role === 'owner';
  const isOwner = role === 'owner';

  const links: Array<{ label: string; icon: React.ReactNode; onClick: () => void }> = [
    { label: 'Classes', icon: <CalendarDays className="w-5 h-5" />, onClick: () => onNavigate('gym-classes') },
    { label: 'Announcements', icon: <Megaphone className="w-5 h-5" />, onClick: () => onNavigate('gym-announcements') },
    { label: 'Membership', icon: <CreditCard className="w-5 h-5" />, onClick: () => onNavigate('gym-membership') },
  ];

  const staffButtons: Array<{ label: string; icon: React.ReactNode; onClick: () => void }> = [
    { label: 'Check-in console', icon: <MonitorSmartphone className="w-4 h-4" />, onClick: () => onNavigate('gym-console') },
  ];
  if (isManagerPlus) {
    staffButtons.push(
      { label: 'Members', icon: <Users className="w-4 h-4" />, onClick: () => onNavigate('gym-members') },
      { label: 'Manage classes', icon: <ListChecks className="w-4 h-4" />, onClick: () => onNavigate('gym-classes-manage') },
    );
  }
  if (isOwner) {
    staffButtons.push(
      { label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, onClick: () => onNavigate('gym-dashboard') },
      { label: 'Gym settings', icon: <Settings className="w-4 h-4" />, onClick: () => onNavigate('gym-settings') },
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">My Gym</h1>
      </div>

      <div className={`rounded-xl border p-4 flex items-center gap-3 ${cardBg} ${cardBorder}`}>
        {gym.logoUrl ? (
          <img src={gym.logoUrl} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-lg truncate">{gym.name}</div>
          {gym.address && <div className={`text-xs truncate ${subtle}`}>{gym.address}</div>}
        </div>
        {gym.accentColor && (
          <span
            className="w-4 h-4 rounded-full border border-white/20 shrink-0"
            style={{ backgroundColor: gym.accentColor }}
            title="Gym accent colour"
          />
        )}
      </div>

      {membership ? (
        <MembershipCard gym={gym} member={membership} isDark={isDark} />
      ) : (
        <div className={`rounded-xl border p-4 text-sm ${cardBg} ${cardBorder} ${subtle}`}>Loading your membership…</div>
      )}

      <button
        onClick={() => onNavigate('gym-checkin')}
        className="w-full py-3.5 rounded-xl text-base font-bold bg-gradient-to-r from-orange-500 to-red-600 text-white flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
      >
        <ScanLine className="w-5 h-5" /> Check in
      </button>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Today's classes</h2>
        {classes === null ? (
          <p className={`text-sm ${subtle}`}>Loading…</p>
        ) : todaySessions.length === 0 ? (
          <p className={`text-sm ${subtle}`}>No classes today.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {todaySessions.map(({ cls, date }) => (
              <button
                key={cls.id}
                onClick={() => onNavigate('gym-class', { classId: `${cls.id}|${date}` })}
                className={`shrink-0 min-w-[140px] rounded-xl border p-3 text-left ${cardBg} ${cardBorder}`}
              >
                <div className="text-sm font-semibold truncate">{cls.name}</div>
                <div className={`text-xs mt-0.5 ${subtle}`}>{formatTime12h(cls.startTime)} · {cls.durationMin}m</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Announcements</h2>
        {announcements === null ? (
          <p className={`text-sm ${subtle}`}>Loading…</p>
        ) : announcements.length === 0 ? (
          <p className={`text-sm ${subtle}`}>Nothing posted yet.</p>
        ) : (
          <div className="space-y-2">
            {announcements.map((a) => (
              <div key={a.id} className={`rounded-xl border p-3 ${cardBg} ${cardBorder}`}>
                <p className="text-sm line-clamp-2">{a.text}</p>
                <p className={`text-xs mt-1 ${subtle}`}>{a.byName}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {links.map((l) => (
          <button
            key={l.label}
            onClick={l.onClick}
            className={`rounded-xl border p-3 flex flex-col items-center gap-1.5 text-xs font-medium ${cardBg} ${cardBorder}`}
          >
            <span className="text-orange-400">{l.icon}</span>
            {l.label}
          </button>
        ))}
      </div>

      {isStaff && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            Staff <ChevronRight className="w-3.5 h-3.5" />
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {staffButtons.map((b) => (
              <button
                key={b.label}
                onClick={b.onClick}
                className={`rounded-xl border p-3 flex items-center gap-2 text-sm font-medium ${cardBg} ${cardBorder}`}
              >
                <span className="text-orange-400">{b.icon}</span>
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
