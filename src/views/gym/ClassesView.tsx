import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymClass, GymMember } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { listenToClasses, listMembers, upcomingSessions } from '../../gymService';
import { trainerName, dayLabel } from '../../gymMemberHelpers';
import { ClassSessionRow } from '../../components';
import { useToast } from '../../ui';

/** Next 7 days of classes, grouped by day. Trainer names come from
 *  listMembers, which only staff can list (see firestore.rules) — for a
 *  plain member the lookup is skipped and every row falls back to
 *  "Trainer". */
export function ClassesView({ isDark, onBack, onNavigate }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const [classes, setClasses] = useState<GymClass[] | null>(null);
  const [members, setMembers] = useState<GymMember[]>([]);
  const { showToast } = useToast();
  const isStaff = role === 'trainer' || role === 'manager' || role === 'owner';

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  useEffect(() => {
    if (!gym?.id) return;
    return listenToClasses(gym.id, setClasses);
  }, [gym?.id]);

  useEffect(() => {
    if (!gym?.id || !isStaff) return;
    listMembers(gym.id)
      .then(setMembers)
      .catch((err) => { console.warn('[Classes] members lookup unavailable:', err); setMembers([]); });
  }, [gym?.id, isStaff]);

  const grouped = useMemo(() => {
    const sessions = upcomingSessions(classes ?? [], new Date(), 7);
    const map = new Map<string, Array<{ cls: GymClass; date: string }>>();
    for (const s of sessions) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return Array.from(map.entries());
  }, [classes]);

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Classes</h1>
      </div>

      {!gym || classes === null ? (
        <div className={`rounded-xl border p-6 text-center text-sm ${cardBg} ${cardBorder} ${subtle}`}>Loading classes…</div>
      ) : grouped.length === 0 ? (
        <div className={`rounded-xl border p-6 text-center text-sm ${cardBg} ${cardBorder} ${subtle}`}>No classes scheduled this week.</div>
      ) : (
        grouped.map(([date, items]) => (
          <div key={date} className="space-y-2">
            <h2 className={`text-sm font-semibold uppercase tracking-wide ${subtle}`}>{dayLabel(date)}</h2>
            <div className="space-y-2">
              {items.map(({ cls }) => (
                <ClassSessionRow
                  key={`${cls.id}_${date}`}
                  gymId={gym.id}
                  cls={cls}
                  date={date}
                  myUid={user?.uid ?? null}
                  trainerName={trainerName(cls.trainerUid, members)}
                  isDark={isDark}
                  onTap={() => onNavigate('gym-class', { classId: `${cls.id}|${date}` })}
                  onError={(msg) => showToast(msg, 'error')}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
