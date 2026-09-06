import { useState } from 'react';
import { Flame, Star } from 'lucide-react';
import { StreakModal } from './StreakModal';

interface Props {
  /** Weeks in the current streak. */
  streakCount: number;
  /** Days/week the streak is measured at (1–6). ≥2 shows the star badge. */
  level: number;
  /** True when the user has trained at least once this week. */
  active: boolean;
  isDark: boolean;
}

/**
 * Small pill in the app header showing the current N★ streak. A filled
 * flame (accent) = trained this week, a dimmed outlined flame = not yet.
 * Tapping opens the full streak modal with calendar + freeze details.
 * Restyled onto the token palette (docs/REVAMP_SPEC.md §3); `isDark` is
 * kept only to forward into `StreakModal`, which isn't part of this
 * pass.
 */
export function StreakButton({ streakCount, level, active, isDark }: Props) {
  const [open, setOpen] = useState(false);
  const showStar = level >= 2;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`${streakCount} week streak${showStar ? ` at ${level} days/week` : ''}`}
        className={`flex items-center gap-1 h-8 px-2.5 rounded-full text-xs font-bold transition-colors ${
          active ? 'bg-accent text-white' : 'bg-surface-2 text-subtle hover:text-muted'
        }`}
      >
        <Flame className={`w-3.5 h-3.5 ${active ? '' : 'opacity-60'}`} fill={active ? 'currentColor' : 'none'} />
        {streakCount}
        {showStar && (
          <span className="flex items-center gap-0.5 pl-1 ml-0.5 border-l border-current/30">
            {level}
            <Star className="w-3 h-3" fill="currentColor" />
          </span>
        )}
      </button>
      {open && <StreakModal onClose={() => setOpen(false)} isDark={isDark} />}
    </>
  );
}
