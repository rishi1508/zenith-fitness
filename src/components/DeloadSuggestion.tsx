import { useState } from 'react';
import { TrendingDown, X } from 'lucide-react';
import type { DeloadSuggestion as DeloadData } from '../deloadDetector';

interface DeloadSuggestionProps {
  data: DeloadData;
  isDark: boolean;
}

const DISMISS_KEY_PREFIX = 'zenith_deload_dismissed_';

/**
 * Subtle banner on the Home screen when the user has been ramping volume
 * for 3+ consecutive weeks. Dismiss is sticky for the current calendar
 * week so we don't re-prompt them every time they open the app.
 */
export function DeloadSuggestion({ data, isDark }: DeloadSuggestionProps) {
  const weekStamp = getWeekStamp();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY_PREFIX + weekStamp) === '1'; }
    catch { return false; }
  });

  if (!data.recommend || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY_PREFIX + weekStamp, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div
      className={`rounded-xl p-3 border flex items-start gap-3 ${
        isDark
          ? 'bg-sky-500/10 border-sky-500/30 text-sky-200'
          : 'bg-sky-50 border-sky-200 text-sky-800'
      }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
        isDark ? 'bg-sky-500/20 text-sky-400' : 'bg-sky-100 text-sky-600'
      }`}>
        <TrendingDown className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">Time for a deload?</div>
        <div className={`text-xs mt-0.5 ${isDark ? 'text-sky-300/80' : 'text-sky-700/90'}`}>
          Volume has climbed {data.risingStreak} weeks in a row. Try aiming
          for ~{Math.round(data.targetVolume / 1000)}k kg this week to let
          your CNS recover.
        </div>
      </div>
      <button
        onClick={dismiss}
        className={`p-1 rounded-md flex-shrink-0 ${
          isDark ? 'hover:bg-sky-500/20' : 'hover:bg-sky-100'
        }`}
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** ISO week (-ish) stamp so the dismiss flag auto-resets weekly. */
function getWeekStamp(): string {
  const d = new Date();
  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const daysSince = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
  const week = Math.floor(daysSince / 7);
  return `${year}-${week}`;
}
