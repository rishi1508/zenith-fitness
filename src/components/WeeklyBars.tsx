import { useRef, useState } from 'react';
import { CAPTION } from '../ui/styles';

export interface WeeklyBarDay {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface WeeklyBarsProps {
  /** 7 days, oldest → newest — the last one is the day being viewed. */
  days: WeeklyBarDay[];
  target: number;
  /** Appended after the formatted number in the header, e.g. "kcal", "glasses". */
  unit: string;
  tone: 'accent' | 'info';
  /** Formats a raw value for display — no unit, e.g. `(v) => Math.round(v).toLocaleString()`. */
  formatValue: (value: number) => string;
  /** Caption, e.g. "This week · kcal". */
  label: string;
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function dayLetter(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return DAY_LETTERS[new Date(y, m - 1, d).getDay()];
}

function fullDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

const TONE = {
  accent: { full: 'bg-accent', muted: 'bg-accent/35' },
  info: { full: 'bg-info', muted: 'bg-info/35' },
} as const;

/**
 * Seven bars for a trailing week — kcal and water on the nutrition diary.
 * Press and slide across the track and each bar reports its day in the
 * header, the same scrub idiom as `components/gym/PeakHours.tsx`; it starts
 * out reading the viewed day (the last one in `days`). Muted bars missed
 * `target`, full-tone bars met it; a dashed line marks the target itself.
 */
export function WeeklyBars({ days, target, unit, tone, formatValue, label }: WeeklyBarsProps) {
  const [active, setActive] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const viewedIndex = days.length - 1;
  const shown = active ?? viewedIndex;
  const colors = TONE[tone];

  const maxValue = Math.max(target, ...days.map((d) => d.value), 1);
  const hasTarget = target > 0;
  const targetPct = hasTarget ? Math.min(100, (target / maxValue) * 100) : 0;

  const logged = days.filter((d) => d.value > 0);
  const onTarget = logged.filter((d) => d.value >= target).length;

  /** Which bar sits under this x position, so a slide reads continuously
   *  rather than only when a finger happens to land on a bar. */
  const barAt = (clientX: number): number | null => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const i = Math.floor(((clientX - box.left) / box.width) * days.length);
    return i >= 0 && i < days.length ? i : null;
  };

  const shownValue = days[shown]?.value ?? 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <span className={CAPTION}>{label}</span>
        <span className="text-[13px] font-bold tabular-nums text-text">
          {formatValue(shownValue)}{hasTarget ? ` / ${formatValue(target)}` : ''}{' '}
          <span className="font-medium text-muted">{unit}</span>
        </span>
      </div>

      <div className="relative h-14">
        {hasTarget && (
          <div className="absolute left-0 right-0 border-t border-dashed border-border" style={{ bottom: `${targetPct}%` }}>
            <span className="absolute right-0 -top-3 text-[9px] font-semibold text-subtle">target</span>
          </div>
        )}
        <div
          ref={trackRef}
          data-elastic-skip
          className="relative flex items-stretch gap-1 h-full touch-none select-none"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActive(barAt(e.clientX)); }}
          onPointerMove={(e) => { if (e.buttons > 0 || e.pointerType === 'touch') setActive(barAt(e.clientX)); }}
          onPointerUp={() => setActive(null)}
          onPointerCancel={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          {days.map((d, i) => {
            const met = hasTarget && d.value >= target;
            const pct = d.value > 0 ? Math.max((d.value / maxValue) * 100, 4) : 2;
            return (
              <button
                key={d.date}
                type="button"
                aria-label={`${fullDate(d.date)}: ${formatValue(d.value)} ${unit}${hasTarget ? `, target ${formatValue(target)}` : ''}`}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className={`flex-1 h-full flex flex-col justify-end min-w-0 rounded-t-[4px] outline-none ${
                  i === viewedIndex ? 'bg-surface-2' : ''
                }`}
              >
                <span
                  className={`w-full rounded-t-[4px] transition-colors ${
                    i === active ? colors.full : met ? colors.full : colors.muted
                  }`}
                  style={{ height: `${pct}%` }}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-1 mt-1">
        {days.map((d, i) => (
          <span
            key={d.date}
            className={`flex-1 text-center text-[11px] font-bold ${i === viewedIndex ? 'text-text' : 'text-subtle'}`}
          >
            {dayLetter(d.date)}
          </span>
        ))}
      </div>

      <p className="text-xs text-subtle mt-2">
        {logged.length === 0
          ? 'Log a few days and the week fills in.'
          : `On target ${onTarget} of ${logged.length} logged day${logged.length === 1 ? '' : 's'}.`}
      </p>
    </div>
  );
}
