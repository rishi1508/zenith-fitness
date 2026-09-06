import { useEffect, useRef, useState } from 'react';
import { Minus, Pencil, Plus } from 'lucide-react';
import type { ChartSettings } from '../types';
import { MA_WINDOW_MAX, MA_WINDOW_MIN, MA_WINDOW_PRESETS } from './chartMath';
import type { SeriesKey } from './useChartSettings';

interface ChartSettingsBarProps {
  settings: ChartSettings;
  isDark: boolean;
  /** Colour of the raw series — used for the active "Points" chip. */
  accent: string;
  onToggle: (key: SeriesKey) => void;
  onWindowChange: (window: number) => void;
}

/** Header chips: `${n}-MA` (with a pencil that opens the window editor) and
 *  `Points`. Tapping toggles the series; the parent guarantees at least one
 *  stays on. */
export function ChartSettingsBar({ settings, isDark, accent, onToggle, onWindowChange }: ChartSettingsBarProps) {
  const [editing, setEditing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the window editor when tapping anywhere outside it.
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setEditing(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [editing]);

  const w = settings.movingAverageWindow;
  const chip = 'text-[10px] leading-4 px-1.5 py-0.5 select-none';
  const inactive = isDark ? 'bg-[#252525] text-zinc-500' : 'bg-gray-100 text-gray-400';
  const maActive = 'bg-cyan-500/15 text-cyan-400';
  const stepBtn = `w-7 h-7 flex items-center justify-center rounded disabled:opacity-30 ${
    isDark ? 'bg-[#1a1a1a] text-zinc-300 hover:text-white' : 'bg-gray-100 text-gray-600 hover:text-gray-900'
  }`;

  return (
    <div ref={rootRef} className="relative flex items-center gap-1.5">
      <div className="flex items-center rounded overflow-hidden">
        <button
          type="button"
          aria-pressed={settings.showMovingAverage}
          onClick={() => onToggle('showMovingAverage')}
          className={`${chip} ${settings.showMovingAverage ? maActive : inactive}`}
        >
          {w}-MA
        </button>
        <button
          type="button"
          aria-label="Edit moving-average window"
          onClick={() => setEditing(v => !v)}
          className={`${chip} border-l ${settings.showMovingAverage ? maActive : inactive} ${isDark ? 'border-[#1a1a1a]' : 'border-white'}`}
        >
          <Pencil size={10} />
        </button>
      </div>

      <button
        type="button"
        aria-pressed={settings.showRawPoints}
        onClick={() => onToggle('showRawPoints')}
        className={`${chip} rounded ${settings.showRawPoints ? '' : inactive}`}
        style={settings.showRawPoints ? { backgroundColor: `${accent}26`, color: accent } : undefined}
      >
        Points
      </button>

      {editing && (
        <div
          className={`absolute left-0 top-full mt-1.5 z-30 rounded-lg border p-2.5 shadow-lg ${
            isDark ? 'bg-[#252525] border-[#3e3e3e]' : 'bg-white border-gray-200'
          }`}
        >
          <div className={`text-[10px] mb-2 whitespace-nowrap ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
            Moving average window
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Decrease" disabled={w <= MA_WINDOW_MIN} onClick={() => onWindowChange(w - 1)} className={stepBtn}>
              <Minus size={12} />
            </button>
            <div className={`w-8 text-center text-sm font-semibold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>{w}</div>
            <button type="button" aria-label="Increase" disabled={w >= MA_WINDOW_MAX} onClick={() => onWindowChange(w + 1)} className={stepBtn}>
              <Plus size={12} />
            </button>
          </div>
          <div className="flex gap-1 mt-2">
            {MA_WINDOW_PRESETS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => onWindowChange(p)}
                className={`${chip} rounded min-w-6 ${p === w ? maActive : inactive}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
