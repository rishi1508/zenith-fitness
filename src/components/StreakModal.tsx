import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Flame, Snowflake, ChevronLeft, ChevronRight, Zap } from 'lucide-react';
import * as storage from '../storage';
import { getStreakState, daysUntilNextFreeze, MAX_FREEZES, weekStartISO } from '../streakService';

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
    cells: Array<{ day: number | null; ds: string; kind: DayKind }>;
    status: 'active' | 'frozen' | 'missed' | 'current' | 'future';
    // Column-range of the active span in this row — used to draw the
    // pill as a single rounded rect, which is the signature Duolingo look.
    pillStart: number;
    pillEnd: number;
  };

  const rows = useMemo<Row[]>(() => {
    const first = new Date(viewedMonth.year, viewedMonth.month, 1);
    const daysInMonth = new Date(viewedMonth.year, viewedMonth.month + 1, 0).getDate();
    const startWeekday = first.getDay();

    type Cell = { day: number | null; ds: string; kind: DayKind };
    const all: Cell[] = [];
    // Leading pads with their ACTUAL dates (previous month tail) so the
    // pill can visually flow across the month boundary if needed.
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(viewedMonth.year, viewedMonth.month, -i);
      all.push({ day: d.getDate(), ds: d.toISOString().slice(0, 10), kind: 'pad' });
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
      all.push({ day, ds, kind });
    }
    // Trailing pads to complete the last week.
    while (all.length % 7 !== 0) {
      const lastDs = all[all.length - 1].ds;
      const d = new Date(lastDs + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      all.push({ day: d.getDate(), ds: d.toISOString().slice(0, 10), kind: 'pad' });
    }

    const out: Row[] = [];
    for (let i = 0; i < all.length; i += 7) {
      const cells = all.slice(i, i + 7);
      const weekStart = cells[0].ds;
      // Figure out the pill span: first and last WORKOUT cell in the row.
      // If there's no workout cell, the pill is absent (start > end).
      let pillStart = 7;
      let pillEnd = -1;
      for (let j = 0; j < 7; j++) {
        if (cells[j].kind === 'workout') {
          if (j < pillStart) pillStart = j;
          if (j > pillEnd) pillEnd = j;
        }
      }
      let status: Row['status'] = 'missed';
      const hasWorkout = pillEnd >= 0;
      const allFuture = cells.every((c) => c.kind === 'future' || (c.kind === 'pad'));
      const isThisWeek = weekStart === thisWeekISO;
      if (hasWorkout) status = 'active';
      else if (frozenWeeks.has(weekStart)) status = 'frozen';
      else if (allFuture) status = 'future';
      else if (isThisWeek) status = 'current';
      else status = 'missed';
      out.push({ weekStart, cells, status, pillStart, pillEnd });
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
  const heroHint = stats.currentStreak === 0
    ? 'One workout anywhere this week lights it up.'
    : 'You earned more this week — keep it alive!';

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

            {/* Motivational card */}
            <div className="px-6 pb-4">
              <div className={`rounded-2xl border flex items-center gap-3 p-3.5 ${
                isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="w-10 h-10 rounded-xl bg-yellow-400/20 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-5 h-5 text-yellow-400" fill="currentColor" />
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
 * A single week row in the calendar. The active-week pill is drawn
 * behind the day numbers as an absolutely-positioned element, spanning
 * from the first worked-out day to the last — so the whole row feels
 * "complete" the moment you've worked out any day in the week. This
 * is the signature Duolingo look.
 */
function WeekRow({
  row, todayIso, isDark,
}: {
  row: {
    weekStart: string;
    cells: Array<{ day: number | null; ds: string; kind: 'workout' | 'rest' | 'today' | 'missed' | 'future' | 'pad' }>;
    status: 'active' | 'frozen' | 'missed' | 'current' | 'future';
    pillStart: number;
    pillEnd: number;
  };
  todayIso: string;
  isDark: boolean;
}) {
  const hasPill = row.pillEnd >= 0;
  // Pill metrics: each column is 1/7 of the row width. We size it with
  // a small inset so the rounded ends don't touch adjacent cells.
  const pillLeftPct = (row.pillStart / 7) * 100;
  const pillWidthPct = ((row.pillEnd - row.pillStart + 1) / 7) * 100;

  // Frozen-week pill (no workouts but rescued by a freeze) gets a sky
  // tint so the user can still tell the week counted.
  const frozenOnly = !hasPill && row.status === 'frozen';

  return (
    <div className="grid grid-cols-7 relative py-1.5">
      {/* Active-week pill behind day numbers */}
      {hasPill && (
        <div
          className="absolute top-1.5 bottom-1.5 rounded-full bg-gradient-to-b from-orange-400 to-red-500 shadow-md shadow-orange-500/30"
          style={{
            left: `calc(${pillLeftPct}% + 2px)`,
            width: `calc(${pillWidthPct}% - 4px)`,
          }}
          aria-hidden
        />
      )}
      {frozenOnly && (
        <div
          className="absolute top-1.5 bottom-1.5 rounded-full bg-sky-500/80 shadow-md shadow-sky-500/30"
          style={{ left: '2px', width: 'calc(100% - 4px)' }}
          aria-hidden
        />
      )}

      {row.cells.map((c, ci) => {
        const isToday = c.ds === todayIso;
        const insidePill = hasPill && ci >= row.pillStart && ci <= row.pillEnd;
        // Text color rules:
        //   - future: nearly invisible
        //   - inside active pill or frozen pill: white (contrast on orange/sky)
        //   - rest day (outside pill): purple
        //   - today (no workout yet this week, so no pill): teardrop below
        //   - regular number: default muted / stronger depending on theme
        let textClass = '';
        if (c.kind === 'future' || c.kind === 'pad') textClass = isDark ? 'text-zinc-700' : 'text-gray-300';
        else if (insidePill || frozenOnly) textClass = 'text-white';
        else if (c.kind === 'rest') textClass = isDark ? 'text-purple-400' : 'text-purple-600';
        else textClass = isDark ? 'text-zinc-400' : 'text-gray-600';

        return (
          <div key={ci} className="relative h-9 flex items-center justify-center">
            {/* Today's teardrop pin — only when there's no pill, so it
                doesn't visually compete with the orange row highlight. */}
            {isToday && !insidePill && !frozenOnly && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-7 h-8 rounded-full bg-sky-400/90 flex items-center justify-center rounded-b-none
                                [clip-path:polygon(50%_100%,0%_50%,0%_0%,100%_0%,100%_50%)]" />
              </div>
            )}
            <span className={`relative z-[1] text-sm font-bold ${isToday && !insidePill && !frozenOnly ? 'text-white' : textClass}`}>
              {c.day}
            </span>
            {/* Small dot under the number for rest days inside or outside
                an active pill — so rest still has a visual cue. */}
            {c.kind === 'rest' && !insidePill && !frozenOnly && (
              <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-purple-500" />
            )}
          </div>
        );
      })}
    </div>
  );
}
