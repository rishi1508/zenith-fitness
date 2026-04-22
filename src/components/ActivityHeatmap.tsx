import { useMemo } from 'react';
import type { Workout } from '../types';

interface Props {
  workouts: Workout[];
  isDark: boolean;
  /** How many weeks of history to show (default: 26 ≈ half a year). */
  weeks?: number;
}

/**
 * GitHub-contribution-style heatmap. 7 rows × N columns, one cell per
 * day; deeper orange = more volume for that day. Rest days get a subtle
 * tint so they don't read as missed.
 */
export function ActivityHeatmap({ workouts, isDark, weeks = 26 }: Props) {
  const { cells, maxVolume, totalActiveDays } = useMemo(() => {
    const dayVolume = new Map<string, { volume: number; isRest: boolean }>();
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

    // End on today, span `weeks * 7` days backwards, aligned to Sunday columns.
    const today = new Date();
    const end = new Date(today);
    // Move end forward to the upcoming Saturday so the grid ends on a full column.
    end.setDate(end.getDate() + (6 - end.getDay()));
    const totalDays = weeks * 7;
    const start = new Date(end);
    start.setDate(end.getDate() - totalDays + 1);

    type Cell = { date: string; volume: number; isRest: boolean; inFuture: boolean } | null;
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
  }, [workouts, weeks]);

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
  const columns: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    columns.push(cells.slice(i, i + 7));
  }

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
      <div className="overflow-x-auto">
        <div className="inline-flex gap-1">
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
                    title={`${cell.date}${cell.volume > 0 ? ` · ${Math.round(cell.volume)} kg` : cell.isRest ? ' · rest day' : ''}`}
                    className={`w-3 h-3 rounded-sm ${color}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
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
