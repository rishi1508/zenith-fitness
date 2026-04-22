import { useState } from 'react';
import { Flame } from 'lucide-react';
import { StreakModal } from './StreakModal';

interface Props {
  streakCount: number;
  active: boolean;
  isDark: boolean;
}

/**
 * Small pill in the app header showing the current streak. A filled
 * flame (orange) = streak active, a dimmed outlined flame = inactive.
 * Tapping opens the full streak modal with calendar + freeze details.
 */
export function StreakButton({ streakCount, active, isDark }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={active ? 'Streak active' : 'Streak inactive'}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
          active
            ? 'bg-gradient-to-r from-orange-500 to-red-600 text-white'
            : isDark
              ? 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
              : 'bg-gray-100 text-gray-500 hover:text-gray-700'
        }`}
      >
        <Flame className={`w-3.5 h-3.5 ${active ? '' : 'opacity-60'}`} fill={active ? 'currentColor' : 'none'} />
        {streakCount}
      </button>
      {open && <StreakModal onClose={() => setOpen(false)} isDark={isDark} />}
    </>
  );
}
