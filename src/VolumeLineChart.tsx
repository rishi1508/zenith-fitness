import { useMemo } from 'react';
import { InteractiveLineChart, type ChartPoint } from './components';

interface Session {
  date: string;
  volume: number;
}

const formatVolume = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);
const formatVolumeTooltip = (v: number) => `${Math.round(v).toLocaleString('en-IN')} kg`;

// Exercise volume trend — thin wrapper over the shared InteractiveLineChart.
export function VolumeLineChart({ sessions, isDark = true }: { sessions: Session[]; isDark?: boolean }) {
  const points = useMemo<ChartPoint[]>(() => sessions.map(s => ({ date: s.date, value: s.volume })), [sessions]);
  return (
    <InteractiveLineChart
      points={points}
      isDark={isDark}
      accent="#f97316"
      gradientId="volumeGradient"
      title="Volume Trend"
      formatValue={formatVolume}
      formatTooltip={formatVolumeTooltip}
      emptyMessage="No data yet"
      minPoints={1}
      headerExtra={<div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{sessions.length} sessions</div>}
    />
  );
}
