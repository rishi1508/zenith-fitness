import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Flame, Snowflake, Dumbbell, Moon, ChevronLeft, ChevronRight } from 'lucide-react';
import * as storage from '../storage';
import { getStreakState, daysUntilNextFreeze, MAX_FREEZES, weekStartISO } from '../streakService';

interface Props {
  onClose: () => void;
  isDark: boolean;
}

/**
 * Streak modal — Duolingo-inspired, now with a WEEKLY streak model.
 *
 * A week (Sun → Sat) is "active" if the user did any non-rest workout
 * that week. One inactive week breaks the streak unless a freeze rescues
 * it. The calendar shows both per-day detail AND a colored pill on the
 * left of each week row so users can see at a glance which weeks counted.
 *
 * The outer fixed container uses flex centering (not translate) so Android
 * WebView can't disagree with the browser about sizing.
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
  const frozenWeeks = useMemo(() => new Set(state.freezeConsumedDates), [state.freezeConsumedDates]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const thisWeekISO = weekStartISO(new Date());
  const now = new Date();

  // Viewed month — prev/next paginates, with a linear slide animation so the
  // transition doesn't feel like a hard cut.
  const [viewedMonth, setViewedMonth] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }));
  const [slide, setSlide] = useState<'idle' | 'left' | 'right'>('idle');
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCurrentMonth = viewedMonth.year === now.getFullYear() && viewedMonth.month === now.getMonth();

  const animateTo = (direction: 'left' | 'right', apply: () => void) => {
    if (animTimer.current) clearTimeout(animTimer.current);
    setSlide(direction);
    // Let the out-animation play, then swap content, then slide back in.
    animTimer.current = setTimeout(() => {
      apply();
      setSlide(direction === 'left' ? 'right' : 'left');
      animTimer.current = setTimeout(() => setSlide('idle'), 20);
    }, 180);
  };

  const goPrev = () => animateTo('right', () => setViewedMonth(({ year, month }) => {
    if (month === 0) return { year: year - 1, month: 11 };
    return { year, month: month - 1 };
  }));
  const goNext = () => {
    if (isCurrentMonth) return;
    animateTo('left', () => setViewedMonth(({ year, month }) => {
      if (month === 11) return { year: year + 1, month: 0 };
      return { year, month: month + 1 };
    }));
  };

  // Touch-swipe handling on the calendar. Horizontal swipes >50px change
  // month; small vertical-dominant drags are ignored so scrolling stays
  // responsive.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStart.current; swipeStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (dx < 0) goNext(); else goPrev();
  };

  // Weeks = array of 6 rows × 7 cells. Each row is one calendar week.
  type DayCell =
    | { kind: 'pad' }
    | { kind: 'day'; day: number; ds: string; type: 'workout' | 'rest' | 'frozen' | 'today' | 'missed' | 'future' };
  type WeekRow = {
    weekStart: string; // YYYY-MM-DD Sunday
    cells: DayCell[];
    // rolled-up state
    status: 'active' | 'rest-only' | 'frozen' | 'missed' | 'current' | 'future';
  };

  const weeks = useMemo<WeekRow[]>(() => {
    const first = new Date(viewedMonth.year, viewedMonth.month, 1);
    const daysInMonth = new Date(viewedMonth.year, viewedMonth.month + 1, 0).getDate();
    const startWeekday = first.getDay();

    const all: DayCell[] = [];
    for (let i = 0; i < startWeekday; i++) all.push({ kind: 'pad' });
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(viewedMonth.year, viewedMonth.month, day);
      const ds = d.toISOString().slice(0, 10);
      let type: Extract<DayCell, { kind: 'day' }>['type'];
      if (ds > todayIso) type = 'future';
      else if (workedOut.has(ds)) type = 'workout';
      else if (restDays.has(ds)) type = 'rest';
      else if (ds === todayIso) type = 'today';
      else type = 'missed';
      all.push({ kind: 'day', day, ds, type });
    }
    // Pad trailing to complete the last week.
    while (all.length % 7 !== 0) all.push({ kind: 'pad' });

    const rows: WeekRow[] = [];
    for (let i = 0; i < all.length; i += 7) {
      const row = all.slice(i, i + 7);
      // Week-start is the Sunday cell — figure it out from the first day
      // cell in the row (pads are from the previous month / after-month).
      const firstDay = row.find((c) => c.kind === 'day') as Extract<DayCell, { kind: 'day' }> | undefined;
      let weekStart = '';
      if (firstDay) {
        const d = new Date(firstDay.ds + 'T00:00:00');
        d.setDate(d.getDate() - d.getDay());
        weekStart = d.toISOString().slice(0, 10);
      }
      // Roll up a week-level status so we can highlight the row.
      let status: WeekRow['status'] = 'missed';
      const anyDay = row.find((c) => c.kind === 'day');
      if (!anyDay) status = 'future';
      else {
        const hasWorkout = row.some((c) => c.kind === 'day' && c.type === 'workout');
        const allFuture = row.every((c) => c.kind !== 'day' || c.type === 'future');
        const isThisWeek = weekStart === thisWeekISO;
        if (hasWorkout) status = 'active';
        else if (frozenWeeks.has(weekStart)) status = 'frozen';
        else if (allFuture) status = 'future';
        else if (isThisWeek) status = 'current';
        else {
          // Row has some days and none are workouts — "rest-only" if at
          // least one logged rest, else it's an outright miss.
          const hasRest = row.some((c) => c.kind === 'day' && c.type === 'rest');
          status = hasRest ? 'rest-only' : 'missed';
        }
      }
      rows.push({ weekStart, cells: row, status });
    }
    return rows;
  }, [viewedMonth, workedOut, restDays, frozenWeeks, todayIso, thisWeekISO]);

  const nextFreezeIn = daysUntilNextFreeze(state);
  const longestStreak = stats.longestStreak || stats.currentStreak || 0;
  const subtle = isDark ? 'text-zinc-400' : 'text-gray-500';

  const monthLabel = new Date(viewedMonth.year, viewedMonth.month, 1).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric',
  });

  // Row-pill color per week status.
  const pillClass = (s: WeekRow['status']): string => {
    switch (s) {
      case 'active': return 'bg-gradient-to-b from-orange-400 to-red-600';
      case 'frozen': return 'bg-sky-500';
      case 'current': return isDark ? 'bg-zinc-700' : 'bg-gray-300';
      case 'rest-only': return 'bg-purple-500';
      case 'missed': return isDark ? 'bg-zinc-800' : 'bg-gray-200';
      case 'future': return 'bg-transparent';
    }
  };

  const weekStreakLabel = stats.currentStreak === 0
    ? 'Start your streak'
    : `${stats.currentStreak} week streak!`;
  const weekStreakHint = stats.currentStreak === 0
    ? 'One workout anywhere this week lights it up.'
    : 'Come back any day this week to keep it alive.';

  // Portal to document.body so header `backdrop-filter` doesn't trap us.
  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/60 z-[99] animate-fadeIn" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-[100] flex sm:items-center sm:justify-center sm:p-4 pointer-events-none">
        <div
          onClick={(e) => e.stopPropagation()}
          className={`w-full sm:w-[480px] sm:max-w-[92vw] sm:max-h-[92vh] sm:rounded-2xl overflow-hidden flex flex-col pointer-events-auto ${
            isDark ? 'bg-[#0f0f0f] text-white' : 'bg-white text-gray-900'
          }`}
        >
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
              <div className="mt-4 text-2xl font-extrabold">{weekStreakLabel}</div>
              <p className={`text-sm mt-1 ${subtle}`}>{weekStreakHint}</p>
            </div>

            {/* Stats grid */}
            <div className="px-6 pb-4 grid grid-cols-2 gap-3">
              <div className={`rounded-xl border p-3 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-[10px] font-semibold uppercase tracking-wider ${subtle}`}>
                  Personal best
                </div>
                <div className="text-lg font-bold text-orange-400 mt-0.5">{longestStreak} {longestStreak === 1 ? 'week' : 'weeks'}</div>
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
                        : `${nextFreezeIn} day${nextFreezeIn === 1 ? '' : 's'} to your next freeze. Rescues one missed week.`}
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

            {/* Monthly calendar — animated month change + row-level week status */}
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

              {/* Animated wrapper. translate-x + opacity are driven by the
                  `slide` state so the user sees a smooth swap instead of
                  an instant jump. Duration kept <200ms per side to stay
                  responsive. */}
              <div className="overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                <div
                  className="transition-transform duration-200 ease-linear"
                  style={{
                    transform: slide === 'left' ? 'translateX(-24px)' : slide === 'right' ? 'translateX(24px)' : 'translateX(0)',
                    opacity: slide === 'idle' ? 1 : 0.35,
                  }}
                >
                  {/* Weekday header — aligned with the 7 columns below, offset by
                      the week-status pill column on the left. */}
                  <div className="flex items-center gap-2 mb-1 pl-4">
                    <div className="grid grid-cols-7 flex-1 text-center">
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                        <div key={i} className={`text-[10px] font-semibold ${subtle}`}>{d}</div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    {weeks.map((week, rowIdx) => (
                      <div key={rowIdx} className="flex items-stretch gap-2">
                        {/* Week-status pill — the visual that makes it obvious
                            whether this WEEK counted toward the streak. */}
                        <div
                          className={`w-1.5 rounded-full self-stretch flex-shrink-0 ${pillClass(week.status)}`}
                          title={week.status}
                        />
                        <div className="grid grid-cols-7 gap-1 flex-1">
                          {week.cells.map((c, i) => {
                            if (c.kind === 'pad') return <div key={i} className="aspect-square" />;
                            const isToday = c.ds === todayIso;
                            let bg = isDark ? 'bg-[#1a1a1a] text-zinc-500' : 'bg-gray-50 text-gray-400';
                            let icon: React.ReactNode = null;
                            if (c.type === 'workout') { bg = 'bg-gradient-to-br from-orange-400 to-red-600 text-white'; icon = <Dumbbell className="w-3 h-3" />; }
                            else if (c.type === 'rest') { bg = 'bg-purple-500 text-white'; icon = <Moon className="w-3 h-3" />; }
                            else if (c.type === 'future') { bg = isDark ? 'bg-transparent text-zinc-700' : 'bg-transparent text-gray-300'; }
                            // Subtle row-level tint for any week that was
                            // active or frozen — makes the whole week feel
                            // "counted" at a glance, which is the new mental
                            // model.
                            const rowTint = (week.status === 'active' || week.status === 'frozen')
                              && (c.type === 'missed' || c.type === 'today')
                              ? (isDark ? 'ring-1 ring-inset ring-orange-500/30' : 'ring-1 ring-inset ring-orange-400/40')
                              : '';
                            return (
                              <div
                                key={i}
                                className={`aspect-square rounded-md flex flex-col items-center justify-center text-[11px] font-medium ${bg} ${rowTint} ${
                                  isToday ? 'ring-2 ring-orange-400 ring-offset-1 ring-offset-transparent' : ''
                                }`}
                              >
                                <span>{c.day}</span>
                                {icon && <span className="opacity-85 -mt-0.5">{icon}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px]">
                <span className="flex items-center gap-1"><span className="w-2 h-3 rounded-full bg-gradient-to-b from-orange-400 to-red-600" /> Active week</span>
                <span className="flex items-center gap-1"><span className="w-2 h-3 rounded-full bg-sky-500" /> Frozen week</span>
                <span className={`flex items-center gap-1 ${subtle}`}><span className={`w-2 h-3 rounded-full ${isDark ? 'bg-zinc-800' : 'bg-gray-200'}`} /> Missed week</span>
                <span className="flex items-center gap-1"><span className="w-4 h-4 rounded-md bg-gradient-to-br from-orange-400 to-red-600 flex items-center justify-center"><Dumbbell className="w-2.5 h-2.5 text-white" /></span> Workout day</span>
                <span className="flex items-center gap-1"><span className="w-4 h-4 rounded-md bg-purple-500 flex items-center justify-center"><Moon className="w-2.5 h-2.5 text-white" /></span> Rest day</span>
              </div>
            </div>

            {/* How it works */}
            <div className="px-6 pb-8">
              <details className={`rounded-xl border p-3 text-xs ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-zinc-400' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                <summary className="cursor-pointer font-semibold select-none">How the streak works</summary>
                <ul className="mt-2 space-y-1.5 pl-4 list-disc marker:text-orange-400">
                  <li>Your streak counts <strong>weeks</strong>, not days. One non-rest workout anywhere in a week (Sun–Sat) marks that whole week active.</li>
                  <li>Miss an entire week? A freeze rescues it automatically — the week still counts toward your streak.</li>
                  <li>A missed week without a freeze resets the streak to 0.</li>
                  <li>You earn a freeze after every 30 consecutive days the streak stays alive, up to 2 in the bank.</li>
                  <li>The row pill on the calendar shows each week's status at a glance — the whole row lights up when you've worked out any day that week.</li>
                </ul>
              </details>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
