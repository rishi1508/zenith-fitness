import { useMemo } from 'react';
import type { BodyWeightEntry } from './types';
import { InteractiveLineChart, type ChartPoint } from './components';

const formatWeight = (v: number) => v.toFixed(1);

// Body-weight trend — thin wrapper over the shared InteractiveLineChart.
// Entries arrive newest-first and are reversed for a left-to-right timeline.
export function BodyWeightChart({ entries, isDark }: { entries: BodyWeightEntry[]; isDark: boolean }) {
  const points = useMemo<ChartPoint[]>(
    () => [...entries].reverse().map(e => ({ date: e.date, value: e.weight, note: e.notes })),
    [entries],
  );
  const change = points.length >= 2 ? points[points.length - 1].value - points[0].value : 0;
  const changeClass = change < 0 ? 'text-green-400' : change > 0 ? 'text-red-400' : isDark ? 'text-zinc-400' : 'text-gray-500';

  return (
    <InteractiveLineChart
      points={points}
      isDark={isDark}
      accent="#a855f7"
      gradientId="weightGradient"
      title="Weight Trend"
      formatValue={formatWeight}
      unit="kg"
      emptyMessage="Log at least 2 entries to see trend"
      minPoints={2}
      headerExtra={
        <div className={`text-xs flex items-center gap-1 ${changeClass}`}>
          {change === 0 ? (
            <span>Stable</span>
          ) : (
            <>
              <span>{change < 0 ? '↓' : '↑'}</span>
              <span>{Math.abs(change).toFixed(1)} kg overall</span>
            </>
          )}
        </div>
      }
    />
  );
}
