import { useMemo } from 'react';
import { X, Flame, Snowflake, Dumbbell, Moon, CalendarDays } from 'lucide-react';
import * as storage from '../storage';
import { getStreakState, daysUntilNextFreeze, MAX_FREEZES } from '../streakService';

interface Props {
  onClose: () => void;
  isDark: boolean;
}

/**
 * Duolingo-ish streak modal. Shows:
 *   - current streak + active/inactive state
 *   - freeze count with MAX_FREEZES slots (filled / empty)
 *   - days to next freeze (only when freezes < MAX)
 *   - month calendar with per-day chip: worked-out, rest day, frozen,
 *     or missed.
 */
export function StreakModal({ onClose, isDark }: Props) {
  const state = getStreakState();
  const stats = useMemo(() => storage.calculateStats(), []);
  const workouts = useMemo(() => storage.getWorkouts(), []);

  const workedOut = new Set<string>();
  const restDays = new Set<string>();
  for (const w of workouts) {
    if (!w.completed) continue;
    const d = w.date.slice(0, 10);
    if (w.type === 'rest') restDays.add(d); else workedOut.add(d);
  }
  const frozen = new Set(state.freezeConsumedDates);

  const todayIso = new Date().toISOString().slice(0, 10);
  // Build the current calendar month grid.
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const startWeekday = firstOfMonth.getDay(); // 0 = Sunday

  type Cell = { date: string; kind: 'workout' | 'rest' | 'frozen' | 'missed' | 'empty' | 'today' | 'future' };
  const cells: Cell[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ date: '', kind: 'empty' });
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(now.getFullYear(), now.getMonth(), day);
    const ds = d.toISOString().slice(0, 10);
    let kind: Cell['kind'];
    if (ds > todayIso) kind = 'future';
    else if (workedOut.has(ds)) kind = 'workout';
    else if (restDays.has(ds)) kind = 'rest';
    else if (frozen.has(ds)) kind = 'frozen';
    else if (ds === todayIso) kind = 'today';
    else kind = 'missed';
    cells.push({ date: ds, kind });
  }

  const nextFreezeIn = daysUntilNextFreeze(state);

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className={`w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[90dvh] overflow-y-auto ${
          isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`sticky top-0 flex items-center justify-between p-4 border-b ${
          isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-orange-400" fill="currentColor" />
            <h3 className="font-bold">Your streak</h3>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Big number */}
        <div className="text-center py-6 px-4">
          <div className="text-6xl font-bold bg-gradient-to-br from-orange-400 to-red-600 bg-clip-text text-transparent">
            {stats.currentStreak}
          </div>
          <div className={`text-sm mt-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            day streak
          </div>
        </div>

        {/* Freeze slots */}
        <div className="px-4 pb-4">
          <div className={`text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            Streak freezes
          </div>
          <div className={`rounded-xl p-3 border ${isDark ? 'border-[#2e2e2e] bg-[#252525]' : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-center gap-2">
              {Array.from({ length: MAX_FREEZES }).map((_, i) => {
                const filled = i < state.freezes;
                return (
                  <div
                    key={i}
                    className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
                      filled
                        ? 'bg-gradient-to-br from-sky-400 to-sky-600 text-white'
                        : isDark ? 'bg-[#1a1a1a] border border-[#3e3e3e] text-zinc-600' : 'bg-white border border-gray-200 text-gray-400'
                    }`}
                  >
                    <Snowflake className="w-6 h-6" />
                  </div>
                );
              })}
              <div className="flex-1 ml-2">
                <div className="text-sm font-semibold">
                  {state.freezes} of {MAX_FREEZES} available
                </div>
                <div className={`text-xs ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                  {state.freezes >= MAX_FREEZES
                    ? 'All slots full.'
                    : `Stay consistent ${nextFreezeIn} more day${nextFreezeIn === 1 ? '' : 's'} to earn one.`}
                </div>
              </div>
            </div>
            {state.freezes < MAX_FREEZES && (
              <div className="mt-3">
                <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-[#1a1a1a]' : 'bg-gray-200'}`}>
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-600 transition-all"
                    style={{ width: `${Math.min(100, (state.streakDaysSinceFreezeGain / 30) * 100)}%` }}
                  />
                </div>
                <div className={`text-[10px] mt-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
                  {state.streakDaysSinceFreezeGain} / 30 days toward next freeze
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="px-4 pb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
          <LegendDot color="bg-orange-500" label="Worked out" isDark={isDark} />
          <LegendDot color="bg-purple-500" label="Rest day" isDark={isDark} />
          <LegendDot color="bg-sky-500" label="Frozen" isDark={isDark} />
          <LegendDot color={isDark ? 'bg-zinc-700' : 'bg-gray-200'} label="Missed" isDark={isDark} />
        </div>

        {/* Calendar */}
        <div className="px-4 pb-6">
          <div className={`text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
            <CalendarDays className="w-3.5 h-3.5" />
            {now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={i} className={`text-[10px] font-semibold ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>{d}</div>
            ))}
            {cells.map((c, i) => {
              if (c.kind === 'empty' || c.kind === 'future') {
                return <div key={i} className="aspect-square" />;
              }
              const day = parseInt(c.date.slice(-2), 10);
              const isToday = c.date === todayIso;
              let bg = isDark ? 'bg-zinc-800/60 text-zinc-500' : 'bg-gray-100 text-gray-400';
              let icon: React.ReactNode = null;
              if (c.kind === 'workout') {
                bg = 'bg-orange-500 text-white';
                icon = <Dumbbell className="w-3 h-3" />;
              } else if (c.kind === 'rest') {
                bg = 'bg-purple-500/80 text-white';
                icon = <Moon className="w-3 h-3" />;
              } else if (c.kind === 'frozen') {
                bg = 'bg-sky-500 text-white';
                icon = <Snowflake className="w-3 h-3" />;
              }
              return (
                <div
                  key={i}
                  className={`aspect-square rounded-md flex flex-col items-center justify-center text-[11px] font-medium ${bg} ${
                    isToday ? 'ring-2 ring-orange-400 ring-offset-1 ring-offset-transparent' : ''
                  }`}
                >
                  <span>{day}</span>
                  <span className="opacity-80">{icon}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label, isDark }: { color: string; label: string; isDark: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className={isDark ? 'text-zinc-500' : 'text-gray-500'}>{label}</span>
    </div>
  );
}
