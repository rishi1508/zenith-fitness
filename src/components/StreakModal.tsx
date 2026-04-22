import { useMemo, useState } from 'react';
import { X, Flame, Snowflake, Dumbbell, Moon, ChevronLeft, ChevronRight } from 'lucide-react';
import * as storage from '../storage';
import { getStreakState, daysUntilNextFreeze, MAX_FREEZES } from '../streakService';

interface Props {
  onClose: () => void;
  isDark: boolean;
}

/**
 * Streak modal — Duolingo-inspired.
 *
 * Layout: the outer fixed container uses absolute positioning (not flex)
 * for the sheet so Android WebView can't disagree with the browser about
 * `h-full` resolution. On mobile the sheet is pinned to all four edges;
 * on desktop it's centered with an explicit width and translate.
 *
 * Content includes a flame hero, a monthly calendar the user can page
 * through via prev/next buttons, stat tiles, and freeze slots.
 */
export function StreakModal({ onClose, isDark }: Props) {
  const state = getStreakState();
  const stats = useMemo(() => storage.calculateStats(), []);
  const workouts = useMemo(() => storage.getWorkouts(), []);

  // Day-type sets keyed by YYYY-MM-DD.
  const { workedOut, restDays } = useMemo(() => {
    const w = new Set<string>(); const r = new Set<string>();
    for (const wk of workouts) {
      if (!wk.completed) continue;
      const d = wk.date.slice(0, 10);
      if (wk.type === 'rest') r.add(d); else w.add(d);
    }
    return { workedOut: w, restDays: r };
  }, [workouts]);
  const frozen = useMemo(() => new Set(state.freezeConsumedDates), [state.freezeConsumedDates]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const now = new Date();

  // Viewed month — prev/next paginates.
  const [viewedMonth, setViewedMonth] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }));
  const isCurrentMonth = viewedMonth.year === now.getFullYear() && viewedMonth.month === now.getMonth();

  const monthCells = useMemo(() => {
    const first = new Date(viewedMonth.year, viewedMonth.month, 1);
    const daysInMonth = new Date(viewedMonth.year, viewedMonth.month + 1, 0).getDate();
    const startWeekday = first.getDay(); // 0 = Sun
    type Cell =
      | { kind: 'pad' }
      | { kind: 'day'; day: number; ds: string; type: 'workout' | 'rest' | 'frozen' | 'today' | 'missed' | 'future' };
    const cells: Cell[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ kind: 'pad' });
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(viewedMonth.year, viewedMonth.month, day);
      const ds = d.toISOString().slice(0, 10);
      let type: Extract<Cell, { kind: 'day' }>['type'];
      if (ds > todayIso) type = 'future';
      else if (workedOut.has(ds)) type = 'workout';
      else if (restDays.has(ds)) type = 'rest';
      else if (frozen.has(ds)) type = 'frozen';
      else if (ds === todayIso) type = 'today';
      else type = 'missed';
      cells.push({ kind: 'day', day, ds, type });
    }
    return cells;
  }, [viewedMonth, workedOut, restDays, frozen, todayIso]);

  const nextFreezeIn = daysUntilNextFreeze(state);
  const longestStreak = stats.longestStreak || stats.currentStreak || 0;
  const subtle = isDark ? 'text-zinc-400' : 'text-gray-500';

  const monthLabel = new Date(viewedMonth.year, viewedMonth.month, 1).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric',
  });

  const goPrev = () => setViewedMonth(({ year, month }) => {
    if (month === 0) return { year: year - 1, month: 11 };
    return { year, month: month - 1 };
  });
  const goNext = () => setViewedMonth(({ year, month }) => {
    if (month === 11) return { year: year + 1, month: 0 };
    return { year, month: month + 1 };
  });

  return (
    <>
      {/* Two siblings at the app's portal root — no h-full inheritance
          through a fixed parent (which Android WebView has historically
          been flaky about). Backdrop has its own z-index below the sheet. */}
      <div
        className="fixed inset-0 bg-black/60 z-[99] animate-fadeIn"
        onClick={onClose}
        aria-hidden
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fixed inset-0 z-[100] overflow-hidden flex flex-col sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[480px] sm:max-w-[92vw] sm:max-h-[92vh] sm:rounded-2xl animate-fadeIn ${
          isDark ? 'bg-[#0f0f0f] text-white' : 'bg-white text-gray-900'
        }`}
      >
        {/* Sticky close bar, respecting the Android status bar inset */}
        <div
          className="flex items-center justify-end flex-none"
          style={{
            paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)',
            paddingRight: '10px',
            paddingBottom: '6px',
          }}
        >
          <button
            onClick={onClose}
            aria-label="Close"
            className={`p-2 rounded-full transition-colors ${
              isDark ? 'hover:bg-white/10 text-zinc-300' : 'hover:bg-black/5 text-gray-600'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}
        >
          {/* Hero */}
          <div className="flex flex-col items-center text-center px-6 pt-2 pb-6 bg-gradient-to-b from-orange-500/20 via-orange-500/5 to-transparent">
            <div className="relative inline-flex items-center justify-center">
              <Flame
                className="w-28 h-28 text-orange-500 drop-shadow-[0_4px_12px_rgba(249,115,22,0.45)]"
                fill="currentColor"
                strokeWidth={1.25}
              />
              <span
                className="absolute inset-0 flex items-center justify-center text-5xl font-black text-white"
                style={{ textShadow: '0 2px 6px rgba(0,0,0,0.45)' }}
              >
                {stats.currentStreak}
              </span>
            </div>
            <div className="mt-4 text-2xl font-extrabold">
              {stats.currentStreak === 0 ? 'Light up your streak' : `${stats.currentStreak} day streak!`}
            </div>
            <p className={`text-sm mt-1 ${subtle}`}>
              {stats.currentStreak === 0
                ? 'Log a workout today to get started.'
                : 'Keep going — come back tomorrow to keep it alive.'}
            </p>
          </div>

          {/* Stats grid */}
          <div className="px-6 pb-4 grid grid-cols-2 gap-3">
            <div className={`rounded-xl border p-3 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'}`}>
              <div className={`text-[10px] font-semibold uppercase tracking-wider ${subtle}`}>
                Personal best
              </div>
              <div className="text-lg font-bold text-orange-400 mt-0.5">{longestStreak}d</div>
            </div>
            <div className={`rounded-xl border p-3 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'}`}>
              <div className={`text-[10px] font-semibold uppercase tracking-wider ${subtle}`}>
                Freezes
              </div>
              <div className="text-lg font-bold text-sky-400 mt-0.5">
                {state.freezes} / {MAX_FREEZES}
              </div>
            </div>
          </div>

          {/* Freeze slots */}
          <div className="px-6 pb-4">
            <div className={`rounded-xl border p-4 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex gap-1.5 flex-shrink-0">
                  {Array.from({ length: MAX_FREEZES }).map((_, i) => {
                    const filled = i < state.freezes;
                    return (
                      <div
                        key={i}
                        className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          filled
                            ? 'bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-md'
                            : isDark
                              ? 'bg-[#0f0f0f] border border-dashed border-zinc-700 text-zinc-600'
                              : 'bg-white border border-dashed border-gray-300 text-gray-400'
                        }`}
                      >
                        <Snowflake className="w-5 h-5" />
                      </div>
                    );
                  })}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">
                    {state.freezes === MAX_FREEZES ? 'All freezes stocked'
                      : state.freezes > 0 ? `${state.freezes} freeze ready`
                      : 'No freezes right now'}
                  </div>
                  <div className={`text-xs mt-0.5 ${subtle}`}>
                    {state.freezes >= MAX_FREEZES
                      ? "You're maxed out!"
                      : `${nextFreezeIn} day${nextFreezeIn === 1 ? '' : 's'} to your next freeze.`}
                  </div>
                </div>
              </div>
              {state.freezes < MAX_FREEZES && (
                <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-[#0f0f0f]' : 'bg-white'}`}>
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-600 transition-all"
                    style={{ width: `${Math.min(100, (state.streakDaysSinceFreezeGain / 30) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Monthly calendar */}
          <div className="px-6 pb-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={goPrev}
                aria-label="Previous month"
                className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-[#1a1a1a] text-zinc-400' : 'hover:bg-gray-100 text-gray-500'}`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-sm font-semibold">{monthLabel}</div>
              <button
                onClick={goNext}
                disabled={isCurrentMonth}
                aria-label="Next month"
                className={`p-1.5 rounded-lg transition-colors ${
                  isCurrentMonth
                    ? isDark ? 'text-zinc-700' : 'text-gray-300'
                    : isDark ? 'hover:bg-[#1a1a1a] text-zinc-400' : 'hover:bg-gray-100 text-gray-500'
                }`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Weekday header */}
            <div className="grid grid-cols-7 text-center mb-1">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <div key={i} className={`text-[10px] font-semibold ${subtle}`}>{d}</div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-1">
              {monthCells.map((c, i) => {
                if (c.kind === 'pad') return <div key={i} className="aspect-square" />;
                const isToday = c.ds === todayIso;
                let bg = isDark ? 'bg-[#1a1a1a] text-zinc-500' : 'bg-gray-50 text-gray-400';
                let icon: React.ReactNode = null;
                if (c.type === 'workout') { bg = 'bg-gradient-to-br from-orange-400 to-red-600 text-white'; icon = <Dumbbell className="w-3 h-3" />; }
                else if (c.type === 'rest') { bg = 'bg-purple-500 text-white'; icon = <Moon className="w-3 h-3" />; }
                else if (c.type === 'frozen') { bg = 'bg-sky-500 text-white'; icon = <Snowflake className="w-3 h-3" />; }
                else if (c.type === 'future') { bg = isDark ? 'bg-transparent text-zinc-700' : 'bg-transparent text-gray-300'; }
                return (
                  <div
                    key={i}
                    className={`aspect-square rounded-md flex flex-col items-center justify-center text-[11px] font-medium ${bg} ${
                      isToday ? 'ring-2 ring-orange-400 ring-offset-1 ring-offset-transparent' : ''
                    }`}
                  >
                    <span>{c.day}</span>
                    {icon && <span className="opacity-85 -mt-0.5">{icon}</span>}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gradient-to-br from-orange-400 to-red-600" /> Worked out</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" /> Rest</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-500" /> Frozen</span>
              <span className={`flex items-center gap-1 ${subtle}`}><span className={`w-2 h-2 rounded-full ${isDark ? 'bg-zinc-700' : 'bg-gray-200'}`} /> Missed</span>
            </div>
          </div>

          {/* FAQ */}
          <div className="px-6 pb-8">
            <details className={`rounded-xl border p-3 text-xs ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-zinc-400' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
              <summary className="cursor-pointer font-semibold select-none">How the streak works</summary>
              <ul className="mt-2 space-y-1.5 pl-4 list-disc marker:text-orange-400">
                <li>Any completed workout — or a logged rest day — counts.</li>
                <li>Miss a day? A freeze (if you have one) covers it.</li>
                <li>Stay consistent for 30 days to earn a new freeze (max 2).</li>
                <li>No freeze + a missed day = streak resets to zero.</li>
              </ul>
            </details>
          </div>
        </div>
      </div>
    </>
  );
}
