import { useMemo, useRef, useState, useEffect } from 'react';
import type { Workout } from '../types';

interface Props {
  workouts?: Workout[];
  /** Pre-computed per-day activity map (from BuddyCompareStats.activityDays).
   *  Values: positive = workout volume, -1 = rest day, 0 / absent = inactive. */
  activityDays?: Record<string, number>;
  isDark: boolean;
  /** How many weeks of history to show (default: 26 ≈ half a year). */
  weeks?: number;
}

type Cell =
  | { date: string; volume: number; isRest: boolean; inFuture: boolean }
  | null;

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * GitHub-contribution-style heatmap. 7 rows × N columns, one cell per
 * day; deeper orange = more volume for that day. Rest days get a subtle
 * purple tint so they don't read as missed.
 *
 * Interactions:
 *   - Desktop hover → floating tooltip with date + volume.
 *   - Mobile long-press (400ms) → same tooltip, positioned above the
 *     fingertip. Release / drag cancels it.
 *   - Left column shows day-of-week initials (S M T W T F S) to make
 *     it obvious which row is which without inspecting a tooltip.
 *
 * Accepts either raw `workouts` (own profile) or a precomputed
 * `activityDays` map (buddy profile — cross-user workouts aren't readable).
 */
export function ActivityHeatmap({ workouts, activityDays, isDark, weeks = 26 }: Props) {
  const { cells, maxVolume, totalActiveDays } = useMemo(() => {
    // Build per-day volume map, either from raw workouts or the prebuilt
    // map. The -1 sentinel means "rest day" in the buddy snapshot.
    const dayVolume = new Map<string, { volume: number; isRest: boolean }>();
    if (activityDays) {
      for (const [ds, v] of Object.entries(activityDays)) {
        if (v < 0) dayVolume.set(ds, { volume: 0, isRest: true });
        else dayVolume.set(ds, { volume: v, isRest: false });
      }
    } else if (workouts) {
      for (const w of workouts) {
        if (!w.completed) continue;
        const d = w.date.slice(0, 10);
        let v = 0;
        if (w.type !== 'rest') {
          for (const ex of w.exercises) {
            for (const s of ex.sets) if (s.completed) v += s.weight * s.reps;
          }
        }
        const prev = dayVolume.get(d);
        dayVolume.set(d, {
          volume: (prev?.volume || 0) + v,
          isRest: w.type === 'rest' ? true : prev?.isRest ?? false,
        });
      }
    }

    // End on the upcoming Saturday so the grid ends on a full column.
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const totalDays = weeks * 7;
    const start = new Date(end);
    start.setDate(end.getDate() - totalDays + 1);

    const grid: Cell[] = [];
    let max = 0;
    let active = 0;
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      const data = dayVolume.get(ds);
      if (d > today) {
        grid.push({ date: ds, volume: 0, isRest: false, inFuture: true });
      } else if (data) {
        max = Math.max(max, data.volume);
        if (data.volume > 0 || data.isRest) active++;
        grid.push({ date: ds, volume: data.volume, isRest: data.isRest, inFuture: false });
      } else {
        grid.push({ date: ds, volume: 0, isRest: false, inFuture: false });
      }
    }
    return { cells: grid, maxVolume: max, totalActiveDays: active };
  }, [workouts, activityDays, weeks]);

  const emptyColor = isDark ? 'bg-zinc-800/50' : 'bg-gray-100';
  const restColor = isDark ? 'bg-purple-500/30' : 'bg-purple-200';
  const tint = (v: number) => {
    if (v <= 0 || maxVolume === 0) return emptyColor;
    const pct = v / maxVolume;
    if (pct < 0.25) return 'bg-orange-500/25';
    if (pct < 0.5) return 'bg-orange-500/50';
    if (pct < 0.75) return 'bg-orange-500/75';
    return 'bg-orange-500';
  };

  // Split cells into columns (weeks). First entry is Sunday by construction.
  const columns: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    columns.push(cells.slice(i, i + 7));
  }

  // --- Tooltip state ---
  const containerRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<
    | { x: number; y: number; cell: NonNullable<Cell> }
    | null
  >(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);

  const showTipAt = (clientX: number, clientY: number, cell: NonNullable<Cell>) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setTip({ x: clientX - bounds.left, y: clientY - bounds.top, cell });
  };
  const hideTip = () => setTip(null);

  // Auto-hide tooltip after a short idle period on mobile so it doesn't
  // linger forever once the user's finger leaves the cell.
  useEffect(() => {
    if (!tip) return;
    const t = setTimeout(hideTip, 2500);
    return () => clearTimeout(t);
  }, [tip]);

  const onCellPointerEnter = (e: React.PointerEvent, cell: NonNullable<Cell>) => {
    // Treat mouse hovers as immediate tooltips. Touch pointers go through
    // the long-press path below.
    if (e.pointerType === 'mouse') showTipAt(e.clientX, e.clientY, cell);
  };
  const onCellPointerDown = (e: React.PointerEvent, cell: NonNullable<Cell>) => {
    if (e.pointerType === 'mouse') return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      suppressClick.current = true;
      showTipAt(e.clientX, e.clientY, cell);
    }, 400);
  };
  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div className={`rounded-xl border p-4 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Last {weeks} weeks
        </div>
        <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          {totalActiveDays} active day{totalActiveDays === 1 ? '' : 's'}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative overflow-x-auto"
        onPointerLeave={() => { clearLongPress(); hideTip(); }}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
      >
        <div className="inline-flex gap-1">
          {/* Day-of-week label column. Single letters to save horizontal
              space; aligned 1:1 with the 7 rows on its right. */}
          <div className="flex flex-col gap-1 mr-0.5 select-none">
            {DAY_LABELS.map((lbl, i) => (
              <div
                key={i}
                className={`w-3 h-3 flex items-center justify-center text-[9px] font-semibold leading-none ${
                  isDark ? 'text-zinc-500' : 'text-gray-400'
                }`}
              >
                {lbl}
              </div>
            ))}
          </div>

          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-1">
              {col.map((cell, ri) => {
                if (!cell || cell.inFuture) {
                  return <div key={ri} className="w-3 h-3 rounded-sm opacity-0" />;
                }
                const color = cell.isRest ? restColor : tint(cell.volume);
                return (
                  <div
                    key={ri}
                    className={`w-3 h-3 rounded-sm ${color} cursor-pointer touch-manipulation`}
                    onPointerEnter={(e) => onCellPointerEnter(e, cell)}
                    onPointerDown={(e) => onCellPointerDown(e, cell)}
                    onClick={(e) => {
                      // If the long-press already triggered, swallow the
                      // synthetic click so we don't immediately hide.
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        e.preventDefault();
                        return;
                      }
                      showTipAt(e.clientX, e.clientY, cell);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Floating tooltip. Positioned well above the finger so a long-
            press user can actually SEE it. 64px clearance above the
            touch point is enough for a thumb + fingernail. */}
        {tip && (
          <div
            className={`pointer-events-none absolute z-10 px-2.5 py-1.5 rounded-md text-[11px] font-medium shadow-xl whitespace-nowrap ${
              isDark ? 'bg-zinc-900 text-white border border-zinc-700' : 'bg-gray-900 text-white'
            }`}
            style={{
              left: Math.max(8, Math.min((containerRef.current?.clientWidth || 240) - 140, tip.x - 60)),
              // Negative offset keeps the card clear of the fingertip.
              // If the row is near the top, flip below the finger instead
              // (via max(8, …)) so it stays on-screen.
              top: Math.max(8, tip.y - 64),
            }}
          >
            <div>{formatDate(tip.cell.date)}</div>
            <div className={`text-[10px] mt-0.5 ${isDark ? 'text-zinc-300' : 'text-zinc-200'}`}>
              {tip.cell.isRest
                ? 'Rest day'
                : tip.cell.volume > 0
                  ? `${formatVolume(tip.cell.volume)} kg total volume`
                  : 'No activity'}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 mt-3 text-[10px] text-zinc-500">
        <span>Less</span>
        <div className={`w-2.5 h-2.5 rounded-sm ${emptyColor}`} />
        <div className="w-2.5 h-2.5 rounded-sm bg-orange-500/25" />
        <div className="w-2.5 h-2.5 rounded-sm bg-orange-500/50" />
        <div className="w-2.5 h-2.5 rounded-sm bg-orange-500/75" />
        <div className="w-2.5 h-2.5 rounded-sm bg-orange-500" />
        <span>More</span>
        <span className="ml-2 flex items-center gap-1"><div className={`w-2.5 h-2.5 rounded-sm ${restColor}`} /> Rest</span>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatVolume(v: number): string {
  if (v >= 10_000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.round(v).toString();
}
