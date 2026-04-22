import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Flame, Snowflake, ChevronLeft, ChevronRight } from 'lucide-react';
import * as storage from '../storage';
import { getStreakState, daysUntilNextFreeze, MAX_FREEZES, weekStartISO } from '../streakService';

/** Did the user work out at least once during the week whose Sunday
 *  start matches `weekStart`? */
function rowsForThisWeek(workedOutDays: Set<string>, weekStart: string): boolean {
  const start = new Date(weekStart + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (workedOutDays.has(d.toISOString().slice(0, 10))) return true;
  }
  return false;
}

interface Props {
  onClose: () => void;
  isDark: boolean;
}

/**
 * Streak modal — Duolingo-inspired.
 *
 * Week-centric visual: every calendar row (Sun–Sat) for a week that has
 * any non-rest workout becomes a big orange pill that sweeps across the
 * whole row. Today gets a blue teardrop marker. The design mirrors
 * Duolingo's "day streak" screen so the "one workout a week is enough"
 * rule is instantly readable: a highlighted row = you made it.
 */
export function StreakModal({ onClose, isDark }: Props) {
  const state = getStreakState();
  const stats = useMemo(() => storage.calculateStats(), []);
  const workouts = useMemo(() => storage.getWorkouts(), []);

  const { workedOutDays, restDays } = useMemo(() => {
    const w = new Set<string>(); const r = new Set<string>();
    for (const wk of workouts) {
      if (!wk.completed) continue;
      const d = wk.date.slice(0, 10);
      if (wk.type === 'rest') r.add(d); else w.add(d);
    }
    return { workedOutDays: w, restDays: r };
  }, [workouts]);
  const frozenWeeks = useMemo(() => new Set(state.freezeConsumedDates), [state.freezeConsumedDates]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const thisWeekISO = weekStartISO(now);

  // Viewed month — prev/next paginates with a linear slide animation.
  const [viewedMonth, setViewedMonth] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }));
  const [slide, setSlide] = useState<'idle' | 'left' | 'right'>('idle');
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCurrentMonth = viewedMonth.year === now.getFullYear() && viewedMonth.month === now.getMonth();

  const animateTo = (direction: 'left' | 'right', apply: () => void) => {
    if (animTimer.current) clearTimeout(animTimer.current);
    setSlide(direction);
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

  // Touch swipe support — horizontal >50px changes month.
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

  // Build calendar rows. Each row represents one week (Sun–Sat).
  type DayKind = 'workout' | 'rest' | 'today' | 'missed' | 'future' | 'pad';
  type Row = {
    weekStart: string;
    cells: Array<{ day: number | null; ds: string; kind: DayKind; inMonth: boolean }>;
    // A week is "active" if ANY day in it had a non-rest workout. The
    // whole-row pill is drawn for active + frozen weeks.
    status: 'active' | 'frozen' | 'missed' | 'current' | 'future';
  };

  const rows = useMemo<Row[]>(() => {
    const first = new Date(viewedMonth.year, viewedMonth.month, 1);
    const daysInMonth = new Date(viewedMonth.year, viewedMonth.month + 1, 0).getDate();
    const startWeekday = first.getDay();

    type Cell = { day: number | null; ds: string; kind: DayKind; inMonth: boolean };
    const all: Cell[] = [];
    // Leading pads are previous-month trailing days; keep their real
    // dates so the row's active-state calc still works across boundaries.
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(viewedMonth.year, viewedMonth.month, -i);
      const ds = d.toISOString().slice(0, 10);
      let kind: DayKind = 'pad';
      if (ds <= todayIso) {
        if (workedOutDays.has(ds)) kind = 'workout';
        else if (restDays.has(ds)) kind = 'rest';
      }
      all.push({ day: d.getDate(), ds, kind, inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(viewedMonth.year, viewedMonth.month, day);
      const ds = d.toISOString().slice(0, 10);
      let kind: DayKind;
      if (ds > todayIso) kind = 'future';
      else if (workedOutDays.has(ds)) kind = 'workout';
      else if (restDays.has(ds)) kind = 'rest';
      else if (ds === todayIso) kind = 'today';
      else kind = 'missed';
      all.push({ day, ds, kind, inMonth: true });
    }
    while (all.length % 7 !== 0) {
      const lastDs = all[all.length - 1].ds;
      const d = new Date(lastDs + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      const ds = d.toISOString().slice(0, 10);
      let kind: DayKind = 'pad';
      if (ds <= todayIso) {
        if (workedOutDays.has(ds)) kind = 'workout';
        else if (restDays.has(ds)) kind = 'rest';
      }
      all.push({ day: d.getDate(), ds, kind, inMonth: false });
    }

    const out: Row[] = [];
    for (let i = 0; i < all.length; i += 7) {
      const cells = all.slice(i, i + 7);
      const weekStart = cells[0].ds;
      const hasWorkout = cells.some((c) => c.kind === 'workout');
      const allFuture = cells.every((c) => c.kind === 'future' || c.kind === 'pad');
      const isThisWeek = weekStart === thisWeekISO;
      let status: Row['status'];
      if (hasWorkout) status = 'active';
      else if (frozenWeeks.has(weekStart)) status = 'frozen';
      else if (allFuture) status = 'future';
      else if (isThisWeek) status = 'current';
      else status = 'missed';
      out.push({ weekStart, cells, status });
    }
    return out;
  }, [viewedMonth, workedOutDays, restDays, frozenWeeks, todayIso, thisWeekISO]);

  const nextFreezeIn = daysUntilNextFreeze(state);
  const longestStreak = stats.longestStreak || stats.currentStreak || 0;
  const subtle = isDark ? 'text-zinc-400' : 'text-gray-500';

  const monthLabel = new Date(viewedMonth.year, viewedMonth.month, 1).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric',
  });

  const weekStreakLabel = stats.currentStreak === 0
    ? 'Start your streak'
    : `${stats.currentStreak} week streak!`;
  // Hint text — neutral / descriptive, NOT marketing copy. Explains the
  // weekly rule on empty-state and nudges on the current week otherwise.
  const activeThisWeek = rowsForThisWeek(workedOutDays, thisWeekISO);
  const heroHint = stats.currentStreak === 0
    ? 'One workout a week is all it takes to keep your streak going.'
    : activeThisWeek
      ? 'This week is already counted — nice work.'
      : 'Work out any day this week to lock it in.';

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
          {/* Top bar */}
          <div
            className="flex items-center justify-between flex-none px-2"
            style={{
              paddingTop: 'max(env(safe-area-inset-top, 0px), 10px)',
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
            <div className="text-sm font-bold tracking-wide">Streak</div>
            <div className="w-9" />
          </div>

          {/* Scrollable body */}
          <div
            className="flex-1 overflow-y-auto"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}
          >
            {/* Hero — Duolingo-style giant number + flame */}
            <div className="px-6 pt-4 pb-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {stats.currentStreak >= 4 && (
                    <div className="inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-yellow-400/20 text-yellow-400 mb-1">
                      Streak Society
                    </div>
                  )}
                  <div className="text-[56px] leading-[1] font-black text-orange-500 tracking-tight">
                    {stats.currentStreak}
                  </div>
                  <div className="text-xl font-extrabold text-orange-500 mt-1">
                    {stats.currentStreak === 1 ? 'week streak!' : stats.currentStreak === 0 ? weekStreakLabel : 'week streak!'}
                  </div>
                </div>
                <div className="relative w-24 h-24 flex-shrink-0 flex items-center justify-center">
                  <Flame
                    className="w-24 h-24 text-orange-500 drop-shadow-[0_6px_18px_rgba(249,115,22,0.5)]"
                    fill="currentColor"
                    strokeWidth={1.25}
                  />
                </div>
              </div>
            </div>

            {/* Descriptive card — explains the weekly rule, not marketing copy. */}
            <div className="px-6 pb-4">
              <div className={`rounded-2xl border flex items-center gap-3 p-3.5 ${
                isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                  <Flame className="w-5 h-5 text-orange-500" fill="currentColor" />
                </div>
                <div className="text-sm leading-tight">
                  {heroHint}
                </div>
              </div>
            </div>

            {/* Calendar */}
            <div className="px-6 pb-4">
              <h3 className="text-lg font-extrabold mb-3">Streak Calendar</h3>

              <div
                className={`rounded-2xl border overflow-hidden ${
                  isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'
                }`}
              >
                {/* Header row */}
                <div className="flex items-center justify-between px-3 py-2">
                  <button
                    onClick={goPrev}
                    aria-label="Previous month"
                    className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-white/5 text-zinc-400' : 'hover:bg-black/5 text-gray-500'}`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="text-sm font-bold">{monthLabel}</div>
                  <button
                    onClick={goNext}
                    disabled={isCurrentMonth}
                    aria-label="Next month"
                    className={`p-1.5 rounded-lg transition-colors ${
                      isCurrentMonth
                        ? isDark ? 'text-zinc-700' : 'text-gray-300'
                        : isDark ? 'hover:bg-white/5 text-zinc-400' : 'hover:bg-black/5 text-gray-500'
                    }`}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Weekday header */}
                <div className="grid grid-cols-7 text-center px-3">
                  {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d, i) => (
                    <div key={i} className={`text-[11px] font-bold uppercase tracking-wider py-1 ${subtle}`}>{d}</div>
                  ))}
                </div>

                {/* Animated swipe wrapper */}
                <div className="overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                  <div
                    className="transition-transform duration-200 ease-linear px-3 pb-3"
                    style={{
                      transform: slide === 'left' ? 'translateX(-24px)' : slide === 'right' ? 'translateX(24px)' : 'translateX(0)',
                      opacity: slide === 'idle' ? 1 : 0.35,
                    }}
                  >
                    {rows.map((row, rowIdx) => (
                      <WeekRow
                        key={rowIdx}
                        row={row}
                        todayIso={todayIso}
                        isDark={isDark}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Stats + Freezes */}
            <div className="px-6 pb-4 grid grid-cols-2 gap-3">
              <div className={`rounded-2xl border p-3 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-[10px] font-bold uppercase tracking-wider ${subtle}`}>Personal best</div>
                <div className="text-xl font-extrabold text-orange-400 mt-0.5">{longestStreak}w</div>
              </div>
              <div className={`rounded-2xl border p-3 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'}`}>
                <div className={`text-[10px] font-bold uppercase tracking-wider ${subtle}`}>Freezes</div>
                <div className="text-xl font-extrabold text-sky-400 mt-0.5">{state.freezes} / {MAX_FREEZES}</div>
              </div>
            </div>

            {/* Freeze detail */}
            <div className="px-6 pb-4">
              <div className={`rounded-2xl border p-4 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex gap-1.5 flex-shrink-0">
                    {Array.from({ length: MAX_FREEZES }).map((_, i) => {
                      const filled = i < state.freezes;
                      return (
                        <div
                          key={i}
                          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            filled
                              ? 'bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-md'
                              : isDark
                                ? 'bg-[#0f0f0f] border-2 border-dashed border-zinc-700 text-zinc-600'
                                : 'bg-white border-2 border-dashed border-gray-300 text-gray-400'
                          }`}
                        >
                          <Snowflake className="w-5 h-5" />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold">
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

            {/* How it works */}
            <div className="px-6 pb-8">
              <details className={`rounded-2xl border p-3.5 text-xs ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-zinc-400' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                <summary className="cursor-pointer font-bold select-none text-sm text-orange-500">How the streak works</summary>
                <ul className="mt-3 space-y-2 pl-4 list-disc marker:text-orange-400">
                  <li>Your streak counts <strong>weeks</strong>, not days. One non-rest workout anywhere in a week (Sun–Sat) marks that whole week active — the row lights up orange.</li>
                  <li>Miss an entire week? A freeze automatically rescues it, so the streak keeps going.</li>
                  <li>A missed week without a freeze resets the streak to 0.</li>
                  <li>You earn a freeze after every 30 consecutive days the streak stays alive, up to 2 in the bank.</li>
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

/**
 * A single week row in the calendar.
 *
 * Visual rules:
 *   - If the week has ≥1 workout → entire row (Sun–Sat) is a single
 *     orange pill. Inside the pill, each day still renders with a
 *     differentiation so rest/workout/missed days are distinguishable:
 *       · Workout day  → day number sits on a solid white chip
 *       · Rest day     → day number inside a dashed white ring
 *       · Missed / today / future → just the number on orange
 *   - If the week has no workout but a freeze was spent on it → sky pill
 *     with the same inside-day rules.
 *   - Otherwise → no pill, day numbers on the plain background; rest
 *     days carry their purple dot for consistency with the rest of the
 *     app.
 */
function WeekRow({
  row, todayIso, isDark,
}: {
  row: {
    weekStart: string;
    cells: Array<{ day: number | null; ds: string; kind: 'workout' | 'rest' | 'today' | 'missed' | 'future' | 'pad'; inMonth: boolean }>;
    status: 'active' | 'frozen' | 'missed' | 'current' | 'future';
  };
  todayIso: string;
  isDark: boolean;
}) {
  const isActive = row.status === 'active';
  const isFrozen = row.status === 'frozen';
  const onPill = isActive || isFrozen;

  return (
    <div className="grid grid-cols-7 relative py-1.5">
      {/* Full-week pill — spans Sun→Sat so the whole row feels "counted"
          the moment you've worked out even one day that week. */}
      {isActive && (
        <div
          className="absolute top-1.5 bottom-1.5 rounded-full bg-gradient-to-b from-orange-400 to-red-500 shadow-md shadow-orange-500/30"
          style={{ left: '2px', width: 'calc(100% - 4px)' }}
          aria-hidden
        />
      )}
      {isFrozen && (
        <div
          className="absolute top-1.5 bottom-1.5 rounded-full bg-sky-500/85 shadow-md shadow-sky-500/30"
          style={{ left: '2px', width: 'calc(100% - 4px)' }}
          aria-hidden
        />
      )}

      {row.cells.map((c, ci) => {
        const isToday = c.ds === todayIso;
        const dimOutOfMonth = !c.inMonth;
        const isWorkout = c.kind === 'workout';
        const isRest = c.kind === 'rest';

        // Number color — white when on the pill, dim when future / out of month.
        let textClass = '';
        if (c.kind === 'future' || (c.kind === 'pad' && !onPill)) {
          textClass = isDark ? 'text-zinc-700' : 'text-gray-300';
        } else if (onPill) {
          textClass = 'text-white';
        } else if (isRest) {
          textClass = isDark ? 'text-purple-300' : 'text-purple-600';
        } else if (isToday) {
          textClass = 'text-white';
        } else {
          textClass = isDark ? 'text-zinc-300' : 'text-gray-700';
        }
        if (dimOutOfMonth) textClass += ' opacity-60';

        return (
          <div key={ci} className="relative h-9 flex items-center justify-center">
            {/* Inside-pill workout chip — solid white bubble behind the
                number so workout days pop against the orange. */}
            {onPill && isWorkout && (
              <div className="absolute w-7 h-7 rounded-full bg-white/95 shadow-sm" aria-hidden />
            )}
            {/* Inside-pill rest-day dashed ring — visually different from
                the workout chip but still obviously "counted". */}
            {onPill && isRest && (
              <div className="absolute w-7 h-7 rounded-full border-2 border-dashed border-white/80" aria-hidden />
            )}
            {/* Today pin when the current week has NO workouts yet (no
                pill). Gives the user a clear "you are here" marker. */}
            {!onPill && isToday && (
              <div className="absolute w-7 h-7 rounded-full bg-sky-400 shadow-md shadow-sky-500/30" aria-hidden />
            )}

            <span
              className={`relative z-[1] text-sm font-bold ${
                (onPill && isWorkout) ? 'text-orange-600' : textClass
              }`}
            >
              {c.day}
            </span>

            {/* Rest-day dot outside an active week — keeps the "rest is
                still logged activity" signal when the pill is absent. */}
            {!onPill && isRest && (
              <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-purple-500" />
            )}
          </div>
        );
      })}
    </div>
  );
}
