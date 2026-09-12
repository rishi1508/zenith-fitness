import { useCallback, useRef } from 'react';
import { useHoldScrub } from '../useHoldScrub';

/** "6 PM" / "12 AM" for an hour index. */
function hourLabel(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${period}`;
}

/**
 * Check-ins by hour of day. A bar chart of 24 unlabelled bars says "evenings
 * are busy" and nothing else, so this one is scrubbable: press and slide
 * across it and each bar reports its hour and its count. Works with a mouse
 * too, and every bar is a real button for anyone using a keyboard or a
 * screen reader.
 */
export function PeakHours({ counts, isDark }: { counts: number[]; isDark: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const busiest = counts.indexOf(max);

  /** Which bar is under this x position — so a slide reads continuously
   *  rather than only when a finger happens to land on a bar. */
  const barAt = useCallback((clientX: number): number | null => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const i = Math.floor(((clientX - box.left) / box.width) * counts.length);
    return i >= 0 && i < counts.length ? i : null;
  }, [counts.length]);
  // Hold, then slide — a plain swipe over the bars scrolls the page.
  const { active, setActive, handlers } = useHoldScrub(barAt);

  const shown = active ?? busiest;
  const cardCls = `rounded-xl border p-4 ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-white border-gray-200'}`;
  const subtle = isDark ? 'text-zinc-500' : 'text-gray-500';

  return (
    <div className={cardCls}>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <div className="text-sm font-medium">Peak hours <span className={subtle}>· last 30 days</span></div>
        <div className="text-sm font-bold tabular-nums">
          {counts[shown]} <span className={`font-medium ${subtle}`}>at {hourLabel(shown)}</span>
        </div>
      </div>

      <div
        ref={trackRef}
        className="flex items-end gap-0.5 h-24 select-none"
        style={{ touchAction: 'pan-y' }}
        {...handlers}
      >
        {counts.map((count, hour) => (
          <button
            key={hour}
            type="button"
            aria-label={`${hourLabel(hour)}: ${count} check-in${count === 1 ? '' : 's'}`}
            onFocus={() => setActive(hour)}
            onBlur={() => setActive(null)}
            className="flex-1 h-full flex items-end min-w-0 outline-none"
          >
            <span
              className={`w-full rounded-sm transition-colors ${
                hour === active ? 'bg-orange-400' : hour === busiest && active === null ? 'bg-orange-500' : 'bg-orange-500/60'
              }`}
              style={{ height: `${count > 0 ? Math.max((count / max) * 100, 4) : 2}%` }}
            />
          </button>
        ))}
      </div>

      <div className={`flex justify-between text-[10px] mt-1 ${subtle}`}>
        <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
      </div>
      <p className={`text-xs mt-2 ${subtle}`}>
        {total === 0
          ? 'No check-ins in the last 30 days.'
          : active === null
            ? `Busiest at ${hourLabel(busiest)}. Hold and slide across for any hour.`
            : `${counts[active]} of ${total} check-ins came in the ${hourLabel(active)} hour.`}
      </p>
    </div>
  );
}
