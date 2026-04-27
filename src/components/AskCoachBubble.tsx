import { Sparkles } from 'lucide-react';

interface Props {
  isDark: boolean;
  onClick: () => void;
  /** When the bottom nav is hidden (e.g. active workout view), drop
   *  the offset so the bubble sits flush above the safe area. */
  navHidden?: boolean;
}

/**
 * Floating "Ask Coach" bubble — global FAB shown across most views
 * once BYOK is configured. Tap → open the AI Coach chat. Sits in the
 * bottom-right above the bottom navigation bar.
 *
 * Visibility is decided by the parent (App.tsx) based on the current
 * view + BYOK state. This component is purely presentational.
 */
export function AskCoachBubble({ isDark, onClick, navHidden }: Props) {
  // ~80px nav + 16px gap. When nav is hidden we drop to a 16px bottom
  // inset (safe-area-inset would be nicer but Tailwind's safe utility
  // varies by version — stick with px math for predictability).
  const bottomCls = navHidden ? 'bottom-4' : 'bottom-20';
  return (
    <button
      onClick={onClick}
      aria-label="Ask the AI Coach"
      title="Ask the AI Coach"
      className={`fixed ${bottomCls} right-4 z-30 w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-transform hover:scale-105 active:scale-95 group bg-gradient-to-br from-orange-500 to-red-600 text-white`}
    >
      {/* Subtle pulse ring — purely cosmetic; signals "live AI". */}
      <span
        className={`absolute inset-0 rounded-full bg-orange-500 opacity-40 group-hover:opacity-50 animate-ping`}
        style={{ animationDuration: '2.4s' }}
        aria-hidden="true"
      />
      {/* Inner solid disc — shadow / contrast against light backgrounds. */}
      <span className={`absolute inset-0 rounded-full ${isDark ? 'ring-1 ring-orange-500/30' : 'ring-2 ring-white/40'}`} aria-hidden="true" />
      <Sparkles className="w-6 h-6 relative z-10" strokeWidth={2.4} />
    </button>
  );
}
