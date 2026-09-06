import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Flame, Snowflake, ChevronLeft, ChevronRight, Star, AlertTriangle } from 'lucide-react';
import * as storage from '../storage';
import {
  computeStreakSummary, localIso, weekStartISO, resolveCommitment,
  MAX_FREEZES, WORKOUTS_TO_EARN_FREEZE, MIN_COMMITMENT, MAX_COMMITMENT,
} from '../streakService';
import type { StreakResult } from '../streakService';
import { registerBackHandler } from '../backHandlerRegistry';

interface Props {
  onClose: () => void;
  isDark: boolean;
}

type DayKind = 'workout' | 'rest' | 'today' | 'missed' | 'future' | 'pad';
type RowStatus = 'active' | 'frozen' | 'partial' | 'missed' | 'current' | 'future';
type Cell = { day: number | null; ds: string; kind: DayKind; inMonth: boolean };
type Row = {
  weekStart: string;
  cells: Cell[];
  status: RowStatus;
  /** Distinct workout days in the full Sun–Sat week (across month edges). */
  workoutDays: number;
  // Column-range (0..6) of the cells that belong to the month this panel
  // is rendering. The pill is drawn across this range only, so a boundary
  // week like "Mar 29–Apr 4" gets one pill on the March panel spanning
  // Sun–Tue and another on the April panel spanning Wed–Sat.
  inMonthStart: number;
  inMonthEnd: number;
};

/**
 * Streak modal — Duolingo-inspired, N★ weekly model.
 *
 * Every calendar row (Sun–Sat) that hit the user's committed days/week
 * becomes a big orange pill. Weeks with some training but short of the
 * target get a dashed outline. Weeks a freeze rescued are sky blue. Today
 * gets a blue teardrop marker.
 */
export function StreakModal({ onClose, isDark }: Props) {
  const workouts = useMemo(() => storage.getWorkouts(), []);
  const [commitmentSetting, setCommitmentSetting] = useState<number | null>(
    () => storage.getAppSettings().streak.commitment,
  );
  const commitment = useMemo(
    () => resolveCommitment({ commitment: commitmentSetting }, storage.getActivePlan()),
    [commitmentSetting],
  );
  const summary = useMemo(() => computeStreakSummary(workouts, commitment), [workouts, commitment]);
  const { shown, committed, ladder } = summary;

  const chooseCommitment = (value: number | null) => {
    storage.updateAppSettings('streak', { commitment: value });
    setCommitmentSetting(value);
    // Header pill + profile snapshot re-read stats on this event.
    window.dispatchEvent(new Event('zenith-data-refresh'));
  };

  const { workedOutDays, restDays } = useMemo(() => {
    const w = new Set<string>(); const r = new Set<string>();
    for (const wk of workouts) {
      if (!wk.completed) continue;
      const d = new Date(wk.date);
      if (Number.isNaN(d.getTime())) continue;
      const ds = localIso(d);
      if (wk.type === 'rest') r.add(ds); else w.add(ds);
    }
    return { workedOutDays: w, restDays: r };
  }, [workouts]);

  const now = new Date();
  const todayIso = localIso(now);
  const thisWeekISO = weekStartISO(now);

  // Viewed month (the one showing at the center of the three-panel track).
  const [viewedMonth, setViewedMonth] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }));
  const isCurrentMonth = viewedMonth.year === now.getFullYear() && viewedMonth.month === now.getMonth();

  // ---- Drag-to-page swipe ----
  // The calendar is rendered as a 3-panel track (prev | current | next),
  // translated to show the center panel. `dragPx` follows the finger in
  // real time so the pane physically slides under the touch. On release
  // we either commit to the adjacent month (if dragged past threshold)
  // or spring back to center. Prev/Next buttons share the same commit
  // path so behaviour is consistent across input methods.
  const trackRef = useRef<HTMLDivElement>(null);
  const swipeAreaRef = useRef<HTMLDivElement>(null);

  // Hardware / browser back press closes the modal instead of popping a
  // view. Registering returns an unregister function, which React's
  // cleanup runs on unmount — so X-button closes work the same way.
  useEffect(() => {
    return registerBackHandler(() => { onClose(); return true; });
  }, [onClose]);
  const [dragPx, setDragPx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const touchRef = useRef<{ x: number; y: number; axis: 'h' | 'v' | null } | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const panelWidth = (): number => {
    const el = trackRef.current;
    if (!el) return typeof window !== 'undefined' ? window.innerWidth : 320;
    // Track contains 3 equal panels, so one panel is 1/3 of the track.
    return el.clientWidth / 3;
  };

  const nextMonthFrom = ({ year, month }: { year: number; month: number }) =>
    month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
  const prevMonthFrom = ({ year, month }: { year: number; month: number }) =>
    month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };

  /** Animate the track to `targetPx`, then optionally swap `viewedMonth`
   *  and snap drag back to 0 without animation. */
  const settle = (targetPx: number, commitShift: -1 | 0 | 1) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    setAnimating(true);
    setDragPx(targetPx);
    commitTimer.current = setTimeout(() => {
      if (commitShift !== 0) {
        setViewedMonth((m) => commitShift === 1 ? nextMonthFrom(m) : prevMonthFrom(m));
      }
      // Kill animation before re-centering so the reset jump is invisible.
      setAnimating(false);
      setDragPx(0);
    }, 200);
  };

  const goNext = () => {
    if (isCurrentMonth || animating) return;
    settle(-panelWidth(), 1);
  };
  const goPrev = () => {
    if (animating) return;
    settle(panelWidth(), -1);
  };

  // React's touch handlers are registered passive, which means we can't
  // call preventDefault() on them to stop the parent `overflow-y-auto`
  // from stealing a horizontal drag as a vertical scroll. Attach a
  // non-passive listener via ref + effect instead.
  useEffect(() => {
    const el = swipeAreaRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (animating) return;
      const t = e.touches[0];
      touchRef.current = { x: t.clientX, y: t.clientY, axis: null };
    };
    const onMove = (e: TouchEvent) => {
      const start = touchRef.current;
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;

      // Axis lock — decide once we have a meaningful drag (~6px). A
      // vertical-dominant move hands off to the outer scroller.
      if (!start.axis) {
        const moved = Math.abs(dx) + Math.abs(dy);
        if (moved < 6) return;
        start.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      if (start.axis === 'v') return;

      // Horizontal axis locked → consume the event so the body scroller
      // doesn't interpret it as a vertical scroll on angled drags.
      e.preventDefault();

      const w = panelWidth();
      let d = dx;
      // Rubber-band when dragging left at the current month (no future).
      if (isCurrentMonth && d < 0) d = d * 0.3;
      d = Math.max(-w, Math.min(w, d));
      setDragPx(d);
    };
    const onEnd = () => {
      const start = touchRef.current;
      if (!start) return;
      touchRef.current = null;
      const w = panelWidth();
      const threshold = w * 0.22;
      // Read current dragPx from the ref since state updates inside a
      // native listener don't see the closed-over value immediately.
      setDragPx((currentDrag) => {
        if (currentDrag < -threshold && !isCurrentMonth) {
          settle(-w, 1);
          return -w;
        } else if (currentDrag > threshold) {
          settle(w, -1);
          return w;
        } else {
          settle(0, 0);
          return 0;
        }
      });
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animating, isCurrentMonth]);

  /** Build rows[] for any {year, month} — used for the three visible panels. */
  const buildRows = (year: number, month: number): Row[] => {
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = first.getDay();

    const kindFor = (ds: string, inMonth: boolean): DayKind => {
      if (ds > todayIso) return inMonth ? 'future' : 'pad';
      if (workedOutDays.has(ds)) return 'workout';
      if (restDays.has(ds)) return 'rest';
      if (!inMonth) return 'pad';
      if (ds === todayIso) return 'today';
      return 'missed';
    };

    const all: Cell[] = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      const ds = localIso(d);
      all.push({ day: d.getDate(), ds, kind: kindFor(ds, false), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = localIso(new Date(year, month, day));
      all.push({ day, ds, kind: kindFor(ds, true), inMonth: true });
    }
    while (all.length % 7 !== 0) {
      const lastDs = all[all.length - 1].ds;
      const d = new Date(lastDs + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      const ds = localIso(d);
      all.push({ day: d.getDate(), ds, kind: kindFor(ds, false), inMonth: false });
    }

    const out: Row[] = [];
    for (let i = 0; i < all.length; i += 7) {
      const cells = all.slice(i, i + 7);
      const weekStart = cells[0].ds;
      // Count the FULL Sun–Sat range across the month boundary — a workout
      // on Apr 2 still lights up the March 29–31 row (same calendar week).
      const workoutDays = cells.filter((c) => c.kind === 'workout').length;
      const inMonthIndices = cells.map((c, idx) => (c.inMonth ? idx : -1)).filter((n) => n >= 0);
      const allInMonthFuture = inMonthIndices.every((idx) => cells[idx].kind === 'future');
      const isThisWeek = weekStart === thisWeekISO;
      let status: RowStatus;
      if (shown.frozenWeeks.has(weekStart)) status = 'frozen';
      else if (workoutDays >= shown.level) status = 'active';
      else if (inMonthIndices.length === 0 || allInMonthFuture) status = 'future';
      else if (isThisWeek) status = 'current';
      else if (workoutDays > 0) status = 'partial';
      else status = 'missed';
      const inMonthStart = inMonthIndices.length ? inMonthIndices[0] : 0;
      const inMonthEnd = inMonthIndices.length ? inMonthIndices[inMonthIndices.length - 1] : -1;
      out.push({ weekStart, cells, status, workoutDays, inMonthStart, inMonthEnd });
    }
    return out;
  };

  const panels = useMemo(() => {
    const prev = prevMonthFrom(viewedMonth);
    const next = nextMonthFrom(viewedMonth);
    return [
      { key: `${prev.year}-${prev.month}`, year: prev.year, month: prev.month, rows: buildRows(prev.year, prev.month) },
      { key: `${viewedMonth.year}-${viewedMonth.month}`, year: viewedMonth.year, month: viewedMonth.month, rows: buildRows(viewedMonth.year, viewedMonth.month) },
      { key: `${next.year}-${next.month}`, year: next.year, month: next.month, rows: buildRows(next.year, next.month) },
    ];
    // buildRows depends on workedOutDays/restDays/shown/today/thisWeek —
    // those change on data refresh, so re-memoize when any of them do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedMonth, workedOutDays, restDays, shown, todayIso, thisWeekISO]);

  const subtle = isDark ? 'text-zinc-400' : 'text-gray-500';
  const card = isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200';

  const monthLabel = new Date(viewedMonth.year, viewedMonth.month, 1).toLocaleDateString('en-IN', {
    month: 'long', year: 'numeric',
  });

  const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  const heroLabel = shown.current === 0
    ? 'Start your streak'
    : shown.level >= 2 ? `${shown.level}★ week streak!` : 'week streak!';
  // Hint text — neutral / descriptive, NOT marketing copy.
  let heroHint: string;
  if (shown.current === 0) {
    heroHint = `Train on ${dayWord(shown.level)} this week (Sun–Sat) to start your streak.`;
  } else if (shown.thisWeekQualified) {
    heroHint = `This week is in — ${dayWord(shown.thisWeekDays)} logged. Nice work.`;
  } else if (shown.thisWeekAtRisk) {
    heroHint = committed.freezes > 0
      ? `Not enough days left this week to hit ${shown.level}. A freeze will cover it automatically.`
      : `Not enough days left this week to hit ${shown.level}, and no freeze left — the streak will reset on Sunday.`;
  } else {
    heroHint = `${dayWord(shown.daysNeededThisWeek)} more this week to lock it in (${shown.thisWeekDays}/${shown.level} so far).`;
  }

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
                  {shown.current >= 4 && (
                    <div className="inline-block text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-yellow-400/20 text-yellow-400 mb-1">
                      Streak Society
                    </div>
                  )}
                  <div className="text-[56px] leading-[1] font-black text-orange-500 tracking-tight">
                    {shown.current}
                  </div>
                  <div className="text-xl font-extrabold text-orange-500 mt-1">{heroLabel}</div>
                  {shown.level >= 2 && shown.current > 0 && (
                    <div className={`text-xs mt-1 ${subtle}`}>
                      {dayWord(shown.level)} a week, {shown.current} {shown.current === 1 ? 'week' : 'weeks'} running
                    </div>
                  )}
                </div>
                <div className="relative w-24 h-24 flex-shrink-0 flex items-center justify-center">
                  <Flame
                    className="w-24 h-24 text-orange-500 drop-shadow-[0_6px_18px_rgba(249,115,22,0.5)]"
                    fill="currentColor"
                    strokeWidth={1.25}
                  />
                  {shown.level >= 2 && (
                    <div className="absolute -bottom-1 -right-1 flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-yellow-400 text-black text-xs font-black shadow-md">
                      {shown.level}
                      <Star className="w-3 h-3" fill="currentColor" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Descriptive card — explains where this week stands. */}
            <div className="px-6 pb-4">
              <div className={`rounded-2xl border flex items-center gap-3 p-3.5 ${card}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  shown.thisWeekAtRisk && !shown.thisWeekQualified ? 'bg-amber-500/15' : 'bg-orange-500/15'
                }`}>
                  {shown.thisWeekAtRisk && !shown.thisWeekQualified
                    ? <AlertTriangle className="w-5 h-5 text-amber-500" />
                    : <Flame className="w-5 h-5 text-orange-500" fill="currentColor" />}
                </div>
                <div className="text-sm leading-tight">{heroHint}</div>
              </div>
            </div>

            {/* Commitment picker */}
            <div className="px-6 pb-4">
              <div className={`rounded-2xl border p-4 ${card}`}>
                <div className="flex items-baseline justify-between mb-2">
                  <div className="text-sm font-bold">Your commitment</div>
                  <div className={`text-xs ${subtle}`}>{dayWord(commitment)} / week</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => chooseCommitment(null)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                      commitmentSetting === null
                        ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
                        : isDark ? 'bg-[#0f0f0f] text-zinc-400 hover:text-zinc-200' : 'bg-white text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Auto
                  </button>
                  {Array.from({ length: MAX_COMMITMENT - MIN_COMMITMENT + 1 }, (_, i) => i + MIN_COMMITMENT).map((n) => (
                    <button
                      key={n}
                      onClick={() => chooseCommitment(n)}
                      className={`w-9 h-8 rounded-full text-xs font-bold transition-colors ${
                        commitmentSetting === n
                          ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
                          : isDark ? 'bg-[#0f0f0f] text-zinc-400 hover:text-zinc-200' : 'bg-white text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className={`text-[11px] mt-2 ${subtle}`}>
                  Auto follows your active plan's training days. Freezes protect this level.
                </div>
              </div>
            </div>

            {/* Calendar */}
            <div className="px-6 pb-4">
              <h3 className="text-lg font-extrabold mb-3">Streak Calendar</h3>

              <div className={`rounded-2xl border overflow-hidden ${card}`}>
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

                {/* Drag-to-page swipe. Three month panels render side by
                    side (prev | current | next) inside an overflow
                    container; the track translates with the finger so
                    the calendar physically follows your swipe. */}
                <div
                  ref={swipeAreaRef}
                  className="overflow-hidden touch-pan-y select-none"
                >
                  <div
                    ref={trackRef}
                    className="flex w-[300%]"
                    style={{
                      transform: `translateX(calc(-33.3333% + ${dragPx}px))`,
                      transition: animating ? 'transform 200ms linear' : 'none',
                      willChange: 'transform',
                    }}
                  >
                    {panels.map((p) => (
                      <div key={p.key} className="w-1/3 flex-shrink-0 px-3 pb-3">
                        {p.rows.map((row, rowIdx) => (
                          <WeekRow
                            key={rowIdx}
                            row={row}
                            todayIso={todayIso}
                            isDark={isDark}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Legend */}
                <div className={`flex flex-wrap gap-x-3 gap-y-1 px-3 pb-3 text-[10px] ${subtle}`}>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-full bg-gradient-to-b from-orange-400 to-red-500" /> hit {shown.level}+</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-full border border-dashed border-orange-400" /> trained, under {shown.level}</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-full bg-sky-500/85" /> frozen</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-purple-500" /> rest</span>
                </div>
              </div>
            </div>

            {/* Stats + Freezes */}
            <div className="px-6 pb-4 grid grid-cols-2 gap-3">
              <div className={`rounded-2xl border p-3 ${card}`}>
                <div className={`text-[10px] font-bold uppercase tracking-wider ${subtle}`}>Personal best</div>
                <div className="text-xl font-extrabold text-orange-400 mt-0.5">{shown.longest}w</div>
              </div>
              <div className={`rounded-2xl border p-3 ${card}`}>
                <div className={`text-[10px] font-bold uppercase tracking-wider ${subtle}`}>Freezes</div>
                <div className="text-xl font-extrabold text-sky-400 mt-0.5">{committed.freezes} / {MAX_FREEZES}</div>
              </div>
            </div>

            {/* Freeze detail */}
            <div className="px-6 pb-4">
              <div className={`rounded-2xl border p-4 ${card}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex gap-1.5 flex-shrink-0">
                    {Array.from({ length: MAX_FREEZES }).map((_, i) => {
                      const filled = i < committed.freezes;
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
                      {committed.freezes === MAX_FREEZES ? 'All freezes stocked'
                        : committed.freezes > 0 ? `${committed.freezes} freeze ready`
                          : 'No freezes right now'}
                    </div>
                    <div className={`text-xs mt-0.5 ${subtle}`}>
                      {committed.freezes >= MAX_FREEZES
                        ? `You're maxed out — the next one is banked once a freeze is used.`
                        : `${committed.workoutsUntilNextFreeze} workout${committed.workoutsUntilNextFreeze === 1 ? '' : 's'} to your next freeze. Rescues one missed week.`}
                    </div>
                  </div>
                </div>
                <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-[#0f0f0f]' : 'bg-white'}`}>
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-400 to-sky-600 transition-all"
                    style={{ width: `${Math.min(100, (committed.freezeProgress / WORKOUTS_TO_EARN_FREEZE) * 100)}%` }}
                  />
                </div>
                <div className={`text-[10px] mt-1 text-right ${subtle}`}>
                  {committed.freezeProgress} / {WORKOUTS_TO_EARN_FREEZE} workouts · {committed.totalWorkoutDays} total
                </div>
              </div>
            </div>

            {/* Ladder — every level at a glance */}
            <div className="px-6 pb-4">
              <div className={`rounded-2xl border p-4 ${card}`}>
                <div className="text-sm font-bold mb-2">All levels</div>
                <div className="space-y-1">
                  {ladder.map((r: StreakResult) => {
                    const isShown = r.level === shown.level;
                    const isCommitted = r.level === committed.level;
                    return (
                      <div
                        key={r.level}
                        className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm ${
                          isShown ? 'bg-orange-500/15' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-8 font-bold ${isShown ? 'text-orange-500' : ''}`}>
                            {r.level}{r.level >= 2 ? '★' : ''}
                          </span>
                          <span className={`text-xs ${subtle}`}>{dayWord(r.level)}/wk</span>
                          {isCommitted && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500">
                              yours
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className={`font-extrabold ${isShown ? 'text-orange-500' : ''}`}>{r.current}w</span>
                          <span className={`text-[10px] ${subtle}`}>best {r.longest}w</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* How it works */}
            <div className="px-6 pb-8">
              <details className={`rounded-2xl border p-3.5 text-xs ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e] text-zinc-400' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                <summary className="cursor-pointer font-bold select-none text-sm text-orange-500">How the streak works</summary>
                <ul className="mt-3 space-y-2 pl-4 list-disc marker:text-orange-400">
                  <li>Your streak counts <strong>weeks</strong> (Sun–Sat). A week counts when you train on at least your committed number of days — a 4★ streak means 4+ training days every week. Rest days don't count.</li>
                  <li>The current week never breaks the streak early: it joins as soon as it qualifies and only counts against you once it's over.</li>
                  <li>Miss the target in a week? A freeze automatically rescues it, so the streak keeps going.</li>
                  <li>Everyone starts with one freeze. You earn another every {WORKOUTS_TO_EARN_FREEZE} workouts, up to {MAX_FREEZES} in the bank.</li>
                  <li>A missed week with no freeze resets the streak to 0.</li>
                  <li>The header shows your committed level — or a higher level if you've been keeping that up just as long.</li>
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
 *   - Week hit the target (≥ level workout days) → orange pill over the
 *     cells that belong to the month THIS panel renders. A week crossing
 *     the month boundary is highlighted on both panels, each pill covering
 *     only its own slice.
 *   - Week has some training but short of the target → dashed orange
 *     outline pill (progress, no credit).
 *   - Week rescued by a freeze → sky pill.
 *   - Inside a pill: workout day → white chip; rest day → dashed ring.
 *   - Otherwise plain background; rest days carry a purple dot.
 *   - Cells from neighbouring months render empty to keep columns aligned.
 */
function WeekRow({
  row, todayIso, isDark,
}: {
  row: Row;
  todayIso: string;
  isDark: boolean;
}) {
  const isActive = row.status === 'active';
  const isFrozen = row.status === 'frozen';
  const isPartial = row.status === 'partial' || (row.status === 'current' && row.workoutDays > 0);
  const onPill = isActive || isFrozen;
  const hasInMonth = row.inMonthEnd >= row.inMonthStart;
  // Pill metrics — each column is 1/7 of the row. Small inset so the
  // rounded ends don't kiss adjacent rows / cells.
  const pillLeftPct = (row.inMonthStart / 7) * 100;
  const pillWidthPct = ((row.inMonthEnd - row.inMonthStart + 1) / 7) * 100;
  const pillStyle = {
    left: `calc(${pillLeftPct}% + 2px)`,
    width: `calc(${pillWidthPct}% - 4px)`,
  };

  return (
    <div className="grid grid-cols-7 relative py-1.5">
      {isActive && hasInMonth && (
        <div
          className="absolute top-1.5 bottom-1.5 rounded-full bg-gradient-to-b from-orange-400 to-red-500 shadow-md shadow-orange-500/30"
          style={pillStyle}
          aria-hidden
        />
      )}
      {isFrozen && hasInMonth && (
        <div
          className="absolute top-1.5 bottom-1.5 rounded-full bg-sky-500/85 shadow-md shadow-sky-500/30"
          style={pillStyle}
          aria-hidden
        />
      )}
      {isPartial && hasInMonth && (
        <div
          className="absolute top-1.5 bottom-1.5 rounded-full border-2 border-dashed border-orange-500/60"
          style={pillStyle}
          aria-hidden
        />
      )}

      {row.cells.map((c, ci) => {
        // Cells outside the current month render as blank spacers. We
        // keep them in the grid so the Sun–Sat columns stay aligned.
        if (!c.inMonth) {
          return <div key={ci} className="relative h-9" />;
        }

        const isToday = c.ds === todayIso;
        const isWorkout = c.kind === 'workout';
        const isRest = c.kind === 'rest';

        // Number color — white when on the pill; dim for future days.
        let textClass = '';
        if (c.kind === 'future') {
          textClass = isDark ? 'text-zinc-700' : 'text-gray-300';
        } else if (onPill) {
          textClass = 'text-white';
        } else if (isPartial && isWorkout) {
          textClass = 'text-white';
        } else if (isRest) {
          textClass = isDark ? 'text-purple-300' : 'text-purple-600';
        } else if (isToday) {
          textClass = 'text-white';
        } else {
          textClass = isDark ? 'text-zinc-300' : 'text-gray-700';
        }

        return (
          <div key={ci} className="relative h-9 flex items-center justify-center">
            {/* Inside-pill workout chip — solid white bubble behind the
                number so workout days pop against the orange. */}
            {onPill && isWorkout && (
              <div className="absolute w-7 h-7 rounded-full bg-white/95 shadow-sm" aria-hidden />
            )}
            {/* Inside-pill rest-day dashed ring. */}
            {onPill && isRest && (
              <div className="absolute w-7 h-7 rounded-full border-2 border-dashed border-white/80" aria-hidden />
            )}
            {/* Partial week: workout days get a small orange chip so the
                progress toward the target is visible. */}
            {!onPill && isPartial && isWorkout && (
              <div className="absolute w-7 h-7 rounded-full bg-orange-500 shadow-sm" aria-hidden />
            )}
            {/* Today pin when the current day has no chip yet. */}
            {!onPill && isToday && !isWorkout && (
              <div className="absolute w-7 h-7 rounded-full bg-sky-400 shadow-md shadow-sky-500/30" aria-hidden />
            )}

            <span
              className={`relative z-[1] text-sm font-bold ${
                (onPill && isWorkout) ? 'text-orange-600' : textClass
              }`}
            >
              {c.day}
            </span>

            {/* Rest-day dot outside a pill — keeps the "rest is still
                logged activity" signal when the pill is absent. */}
            {!onPill && isRest && (
              <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-purple-500" />
            )}
          </div>
        );
      })}
    </div>
  );
}
