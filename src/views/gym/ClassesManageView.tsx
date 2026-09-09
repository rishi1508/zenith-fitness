import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, Pencil, Trash2, Users, X } from 'lucide-react';
import type { GymViewProps } from './types';
import type { GymClass, GymClassSession, GymMember } from '../../types';
import { useGym } from '../../gym/GymContext';
import { useAuth } from '../../auth/AuthContext';
import { isAdmin } from '../../admin';
import { listenToClasses, listenToMembers, saveClass, deleteClass, listenToSession, markAttendance } from '../../gymService';
import { localDateISO } from '../../gymStats';
import { useToast, useConfirm } from '../../ui';

const WEEKDAYS = [
  { id: 1, label: 'Mon' }, { id: 2, label: 'Tue' }, { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' }, { id: 5, label: 'Fri' }, { id: 6, label: 'Sat' },
];
const WEEKDAY_LABEL: Record<number, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

/** Weekly class grid + attendance — see docs/GYM_TIER_A_SPEC.md §6.3.
 *  Manager+ get full CRUD; trainers get attendance-only. */
export function ClassesManageView({ isDark, onBack }: GymViewProps) {
  const { gym, role } = useGym();
  const { user } = useAuth();
  const canManage = role === 'manager' || role === 'owner' || isAdmin(user?.uid);

  const [classes, setClasses] = useState<GymClass[]>([]);
  const [members, setMembers] = useState<GymMember[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingClass, setEditingClass] = useState<GymClass | null>(null);
  const [attendanceClass, setAttendanceClass] = useState<GymClass | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    const gymId = gym?.id;
    if (!gymId) return;
    return listenToClasses(gymId, setClasses);
  }, [gym?.id]);

  useEffect(() => {
    const gymId = gym?.id;
    if (!gymId) return;
    return listenToMembers(gymId, setMembers);
  }, [gym?.id]);

  const trainers = useMemo(() => members.filter((m) => m.role === 'trainer'), [members]);
  const memberByUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);

  const byWeekday = useMemo(() => {
    const map = new Map<number, GymClass[]>();
    for (const cls of classes) {
      const list = map.get(cls.weekday) ?? [];
      list.push(cls);
      map.set(cls.weekday, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [classes]);

  const { confirm: confirmDialog } = useConfirm();
  const handleDelete = async (cls: GymClass) => {
    if (!gym) return;
    if (!(await confirmDialog({ title: 'Delete class?', message: `Delete "${cls.name}" (${WEEKDAY_LABEL[cls.weekday]})? This can't be undone.`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      await deleteClass(gym.id, cls.id);
      showToast('Class deleted');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete class', 'error');
    }
  };

  const handleToggleActive = async (cls: GymClass) => {
    if (!gym) return;
    try {
      await saveClass(gym.id, { ...cls, active: !cls.active });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update class', 'error');
    }
  };

  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const cardCls = `rounded-xl border p-3 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`;

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button aria-label="Back" onClick={onBack} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-[#222]' : 'hover:bg-gray-50'}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Classes</h1>
        </div>
        {canManage && (
          <button
            onClick={() => { setEditingClass(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white"
          >
            <Plus className="w-4 h-4" /> Add class
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {WEEKDAYS.map((wd) => (
          <div key={wd.id} className={cardCls}>
            <div className="text-sm font-semibold mb-2">{wd.label}</div>
            {(byWeekday.get(wd.id) ?? []).length === 0 ? (
              <p className={`text-xs ${subtle}`}>No classes.</p>
            ) : (
              <div className="space-y-2">
                {(byWeekday.get(wd.id) ?? []).map((cls) => (
                  <div
                    key={cls.id}
                    className={`rounded-lg p-2.5 ${isDark ? 'bg-[#0f0f0f]' : 'bg-gray-50'} ${cls.active ? '' : 'opacity-50'}`}
                  >
                    <button onClick={() => setAttendanceClass(cls)} className="w-full text-left flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{cls.name}</div>
                        <div className={`text-xs ${subtle}`}>
                          {cls.startTime} · {cls.durationMin}min
                          {cls.trainerUid && memberByUid.get(cls.trainerUid) ? ` · ${memberByUid.get(cls.trainerUid)?.name}` : ''}
                        </div>
                      </div>
                      <Users className={`w-4 h-4 shrink-0 ${subtle}`} />
                    </button>
                    {canManage && (
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => { setEditingClass(cls); setShowForm(true); }}
                          className={`flex items-center gap-1 text-xs ${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                        <button onClick={() => handleToggleActive(cls)} className={`text-xs ${isDark ? 'text-zinc-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}>
                          {cls.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => handleDelete(cls)} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-400">
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {showForm && gym && (
        <ClassFormSheet
          isDark={isDark}
          gymId={gym.id}
          trainers={trainers}
          editingClass={editingClass}
          onClose={() => setShowForm(false)}
          onSuccess={() => { setShowForm(false); showToast(editingClass ? 'Class updated' : 'Class added'); }}
        />
      )}

      {attendanceClass && gym && (
        <AttendanceSheet
          isDark={isDark}
          gymId={gym.id}
          cls={attendanceClass}
          memberByUid={memberByUid}
          onClose={() => setAttendanceClass(null)}
        />
      )}
    </div>
  );
}

interface ClassFormSheetProps {
  isDark: boolean;
  gymId: string;
  trainers: GymMember[];
  editingClass: GymClass | null;
  onClose: () => void;
  onSuccess: () => void;
}

function ClassFormSheet({ isDark, gymId, trainers, editingClass, onClose, onSuccess }: ClassFormSheetProps) {
  const [name, setName] = useState(editingClass?.name ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(editingClass ? [editingClass.weekday] : []);
  const [startTime, setStartTime] = useState(editingClass?.startTime ?? '07:00');
  const [durationMin, setDurationMin] = useState(String(editingClass?.durationMin ?? 60));
  const [trainerUid, setTrainerUid] = useState(editingClass?.trainerUid ?? '');
  const [capacity, setCapacity] = useState(editingClass?.capacity !== undefined ? String(editingClass.capacity) : '');
  const [active, setActive] = useState(editingClass?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleWeekday = (id: number) => {
    if (editingClass) return; // editing operates on this single class's own weekday only
    setWeekdays((prev) => (prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]));
  };

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white placeholder-zinc-600' : 'bg-gray-50 border-gray-200 placeholder-gray-400'
  }`;
  const labelCls = `text-xs font-medium mb-1 block ${isDark ? 'text-zinc-400' : 'text-gray-500'}`;

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    const targetWeekdays = editingClass ? [editingClass.weekday] : weekdays;
    if (targetWeekdays.length === 0) { setError('Pick at least one day'); return; }
    setSaving(true);
    setError(null);
    try {
      await Promise.all(
        targetWeekdays.map((weekday) =>
          saveClass(gymId, {
            id: editingClass?.id,
            name: name.trim(),
            weekday,
            startTime,
            durationMin: Number(durationMin) || 60,
            trainerUid: trainerUid || undefined,
            capacity: capacity ? Number(capacity) : undefined,
            active,
          }),
        ),
      );
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save class');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center animate-fadeIn" onClick={onClose}>
      <div
        className={`w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`sticky top-0 p-4 border-b flex items-center justify-between ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <h3 className="font-bold">{editingClass ? 'Edit class' : 'Add class'}</h3>
          <button aria-label="Close" onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'text-zinc-500 hover:text-white hover:bg-[#252525]' : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className={labelCls}>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus className={inputCls} placeholder="Yoga" />
          </div>

          <div>
            <label className={labelCls}>{editingClass ? 'Day' : 'Days'}</label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((wd) => {
                const isSelected = editingClass ? editingClass.weekday === wd.id : weekdays.includes(wd.id);
                return (
                  <button
                    key={wd.id}
                    type="button"
                    disabled={!!editingClass}
                    onClick={() => toggleWeekday(wd.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-100 ${
                      isSelected
                        ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
                        : isDark ? 'bg-[#252525] text-zinc-400 hover:bg-[#303030]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {wd.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start time</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Duration (min)</label>
              <input type="number" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} className={inputCls} />
            </div>
          </div>

          {trainers.length > 0 && (
            <div>
              <label className={labelCls}>Trainer</label>
              <select value={trainerUid} onChange={(e) => setTrainerUid(e.target.value)} className={inputCls}>
                <option value="">— none —</option>
                {trainers.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={labelCls}>Capacity (optional)</label>
            <input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Uncapped" className={inputCls} />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-orange-500" />
            Active
          </label>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-orange-500 to-red-600 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface AttendanceSheetProps {
  isDark: boolean;
  gymId: string;
  cls: GymClass;
  memberByUid: Map<string, GymMember>;
  onClose: () => void;
}

function AttendanceSheet({ isDark, gymId, cls, memberByUid, onClose }: AttendanceSheetProps) {
  const [date, setDate] = useState(localDateISO(new Date()));
  const [session, setSession] = useState<GymClassSession | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    return listenToSession(gymId, cls.id, date, setSession);
  }, [gymId, cls.id, date]);

  const handleToggle = async (uid: string, attended: boolean) => {
    setToggling(uid);
    try {
      await markAttendance(gymId, cls.id, date, uid, !attended);
    } finally {
      setToggling(null);
    }
  };

  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';
  const inputCls = `rounded-lg px-3 py-2 text-sm border focus:outline-none focus:border-orange-500 ${
    isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white' : 'bg-gray-50 border-gray-200'
  }`;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center animate-fadeIn" onClick={onClose}>
      <div
        className={`w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`sticky top-0 p-4 border-b flex items-center justify-between ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
          <div>
            <h3 className="font-bold">{cls.name}</h3>
            <p className={`text-xs ${subtle}`}>{WEEKDAY_LABEL[cls.weekday]} · {cls.startTime}</p>
          </div>
          <button aria-label="Close" onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'text-zinc-500 hover:text-white hover:bg-[#252525]' : 'text-gray-400 hover:text-gray-900 hover:bg-gray-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />

          {!session || session.enrolled.length === 0 ? (
            <p className={`text-sm ${subtle}`}>No one enrolled for this date yet.</p>
          ) : (
            <div className={`divide-y ${isDark ? 'divide-[#2e2e2e]' : 'divide-gray-100'}`}>
              {session.enrolled.map((uid) => {
                const attended = session.attended.includes(uid);
                return (
                  <button
                    key={uid}
                    onClick={() => handleToggle(uid, attended)}
                    disabled={toggling === uid}
                    className="w-full flex items-center justify-between py-2.5 text-left"
                  >
                    <span className="text-sm">{memberByUid.get(uid)?.name ?? uid}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${attended ? 'bg-emerald-500/15 text-emerald-500' : `${isDark ? 'bg-[#252525] text-zinc-500' : 'bg-gray-100 text-gray-500'}`}`}>
                      {attended ? 'Attended' : 'Mark attended'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
