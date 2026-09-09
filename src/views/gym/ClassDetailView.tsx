import { useEffect, useState } from 'react';
import { ArrowLeft, Clock, Users } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymClass, GymClassSession, GymMember } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { listClasses, listMembers, listenToSession, enrol, unenrol } from '../../gymService';
import { localDateISO } from '../../gymStats';
import { trainerName, memberName, dayLabel, formatTime12h, endTime12h } from '../../gymMemberHelpers';
import {  } from '../../components';
import { useToast } from '../../ui';

/** `classId` prop arrives as `${classId}|${date}` (ClassesView encodes
 *  the date into the nav param since sessions aren't their own route). */
export function ClassDetailView({ isDark, onBack, classId: encoded }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const [classId, date] = (encoded ?? '').split('|');

  const [classes, setClasses] = useState<GymClass[] | null>(null);
  const [members, setMembers] = useState<GymMember[]>([]);
  const [session, setSession] = useState<GymClassSession | null>(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const cardBg = isDark ? 'bg-[#1a1a1a]' : 'bg-white';
  const cardBorder = isDark ? 'border-[#2e2e2e]' : 'border-gray-200';
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  useEffect(() => {
    if (!gym?.id) return;
    listClasses(gym.id).then(setClasses).catch((err) => console.warn('[ClassDetail] failed to load classes:', err));
  }, [gym?.id]);

  const isStaffViewer = role === 'trainer' || role === 'manager' || role === 'owner';

  // Only staff may list members (see firestore.rules); a plain member
  // skips the lookup and names fall back to "Trainer"/"Member".
  useEffect(() => {
    if (!gym?.id || !isStaffViewer) return;
    listMembers(gym.id)
      .then(setMembers)
      .catch((err) => { console.warn('[ClassDetail] members lookup unavailable:', err); setMembers([]); });
  }, [gym?.id, isStaffViewer]);

  useEffect(() => {
    if (!gym?.id || !classId || !date) return;
    return listenToSession(gym.id, classId, date, setSession);
  }, [gym?.id, classId, date]);

  const cls = classes?.find((c) => c.id === classId);

  if (!gym || !classId || !date) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-3">
          <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Class</h1>
        </div>
        <div className={`rounded-xl border p-6 text-center text-sm ${cardBg} ${cardBorder} ${subtle}`}>Class not found.</div>
      </div>
    );
  }

  if (!cls) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="flex items-center gap-3">
          <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Class</h1>
        </div>
        <div className={`rounded-xl border p-6 text-center text-sm ${cardBg} ${cardBorder} ${subtle}`}>
          {classes === null ? 'Loading…' : "Couldn't find this class."}
        </div>
      </div>
    );
  }

  const enrolled = session?.enrolled ?? [];
  const attended = session?.attended ?? [];
  const isEnrolled = !!user && enrolled.includes(user.uid);
  const isFull = cls.capacity !== undefined && enrolled.length >= cls.capacity && !isEnrolled;

  const handleToggle = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      if (isEnrolled) await unenrol(gym.id, cls.id, date, user.uid);
      else await enrol(gym.id, cls.id, date, user.uid);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update enrolment.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center gap-3">
        <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold truncate">{cls.name}</h1>
      </div>

      <div className={`rounded-xl border p-4 space-y-2 ${cardBg} ${cardBorder}`}>
        <div className={`text-sm font-medium ${subtle}`}>{dayLabel(date)}</div>
        <div className="flex items-center gap-1.5 text-sm">
          <Clock className="w-4 h-4 shrink-0" />
          {formatTime12h(cls.startTime)}–{endTime12h(cls.startTime, cls.durationMin)} · {cls.durationMin}m
        </div>
        <div className={`text-sm ${subtle}`}>Trainer: {trainerName(cls.trainerUid, members)}</div>
        <div className="flex items-center gap-1.5 text-sm">
          <Users className="w-4 h-4 shrink-0" />
          {enrolled.length}{cls.capacity !== undefined ? `/${cls.capacity}` : ''} enrolled
        </div>
        <button
          onClick={handleToggle}
          disabled={busy || (isFull && !isEnrolled)}
          className={`w-full mt-2 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 ${
            isEnrolled
              ? isDark ? 'bg-[#252525] text-zinc-300' : 'bg-gray-100 text-gray-600'
              : 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
          }`}
        >
          {isFull && !isEnrolled ? 'Full' : isEnrolled ? 'Leave class' : 'Enrol'}
        </button>
      </div>

      {isStaffViewer ? (
        <div className={`rounded-xl border p-4 space-y-2 ${cardBg} ${cardBorder}`}>
          <h2 className="text-sm font-semibold">Enrolled ({enrolled.length}{cls.capacity !== undefined ? `/${cls.capacity}` : ''})</h2>
          {enrolled.length === 0 ? (
            <p className={`text-sm ${subtle}`}>No one enrolled yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {enrolled.map((uid) => (
                <li key={uid} className="flex items-center justify-between">
                  <span>{memberName(uid, members)}</span>
                  {attended.includes(uid) && <span className="text-emerald-500 text-xs font-medium">Attended</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : date <= localDateISO(new Date()) && enrolled.length > 0 && (
        // Members can't list names (see firestore.rules), but attendance
        // itself — read-only, never tappable here — is still visible: a
        // headline count plus whether they personally were marked.
        <div className={`rounded-xl border p-4 space-y-1 ${cardBg} ${cardBorder}`}>
          <h2 className="text-sm font-semibold">Attendance</h2>
          <p className={`text-sm ${subtle}`}>{attended.length} of {enrolled.length} enrolled marked attended.</p>
          {user && enrolled.includes(user.uid) && (
            <p className={`text-xs font-medium ${attended.includes(user.uid) ? 'text-emerald-500' : subtle}`}>
              {attended.includes(user.uid) ? 'You were marked attended.' : "You haven't been marked attended yet."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
