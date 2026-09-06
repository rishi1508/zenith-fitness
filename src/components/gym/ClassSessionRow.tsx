import { useEffect, useState } from 'react';
import { Clock, Users } from 'lucide-react';
import type { GymClass, GymClassSession } from '../../types';
import { listenToSession, enrol, unenrol } from '../../gymService';
import { formatTime12h, endTime12h } from '../../gymMemberHelpers';

interface Props {
  gymId: string;
  cls: GymClass;
  date: string;
  trainerName: string;
  myUid: string | null;
  isDark: boolean;
  onTap?: () => void;
  onError?: (message: string) => void;
}

/**
 * One class session row for ClassesView: name/time/trainer, a live
 * enrolled/capacity count (via listenToSession), and an Enrol/Leave
 * button that flips to a disabled "Full" state at capacity.
 */
export function ClassSessionRow({ gymId, cls, date, trainerName, myUid, isDark, onTap, onError }: Props) {
  const [session, setSession] = useState<GymClassSession | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => listenToSession(gymId, cls.id, date, setSession), [gymId, cls.id, date]);

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  const enrolled = session?.enrolled ?? [];
  const isEnrolled = !!myUid && enrolled.includes(myUid);
  const isFull = cls.capacity !== undefined && enrolled.length >= cls.capacity && !isEnrolled;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!myUid || busy) return;
    setBusy(true);
    try {
      if (isEnrolled) await unenrol(gymId, cls.id, date, myUid);
      else await enrol(gymId, cls.id, date, myUid);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Could not update enrolment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onTap}
      className={`rounded-xl border p-3 flex items-center gap-3 ${cardBg} ${cardBorder} ${onTap ? 'cursor-pointer' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate">{cls.name}</div>
        <div className={`text-xs mt-0.5 flex items-center gap-1 ${subtle}`}>
          <Clock className="w-3 h-3 shrink-0" />
          {formatTime12h(cls.startTime)}–{endTime12h(cls.startTime, cls.durationMin)} · {trainerName}
        </div>
        <div className={`text-xs mt-0.5 flex items-center gap-1 ${subtle}`}>
          <Users className="w-3 h-3 shrink-0" />
          {enrolled.length}{cls.capacity !== undefined ? `/${cls.capacity}` : ''} enrolled
        </div>
      </div>
      <button
        onClick={handleToggle}
        disabled={busy || (isFull && !isEnrolled)}
        className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 ${
          isEnrolled
            ? isDark ? 'bg-[#252525] text-zinc-300' : 'bg-gray-100 text-gray-600'
            : isFull
              ? isDark ? 'bg-[#252525] text-zinc-500' : 'bg-gray-100 text-gray-400'
              : 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
        }`}
      >
        {isFull && !isEnrolled ? 'Full' : isEnrolled ? 'Leave' : 'Enrol'}
      </button>
    </div>
  );
}
