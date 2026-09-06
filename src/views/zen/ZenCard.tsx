import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { getZenDailyNote } from '../../zen';
import { Card, Pill, CAPTION } from '../../ui';

interface ZenCardProps {
  /** Opens Zen chat, optionally pre-filling the composer with the daily
   *  note's follow-up prompt. */
  onAskZen: (prompt?: string) => void;
  /** Home-tab placement: tighter copy, and the card renders nothing at
   *  all when there's no note (docs/REVAMP_SPEC.md §6 UI paragraph). */
  compact?: boolean;
}

/**
 * Zen daily-note card — Health tab (always) and Home tab (only when a
 * note exists). Deterministic: `getZenDailyNote()` reads the same
 * rule-based Coach insights `InsightsView` shows, no LLM call.
 */
export function ZenCard({ onAskZen, compact }: ZenCardProps) {
  const note = useMemo(() => getZenDailyNote(), []);
  if (compact && !note) return null;

  return (
    <Card onClick={() => onAskZen(note?.prompt)} className="text-left">
      {!compact && (
        <div className="flex items-center justify-between mb-1">
          <span className={CAPTION}>Zen</span>
          {/* TODO(integrate): swap for PremiumBadge */}
          <Pill tone="accent" icon={Sparkles}>Premium</Pill>
        </div>
      )}
      <p className={`text-sm text-text mb-2 ${compact ? 'line-clamp-1' : 'line-clamp-2'}`}>
        {note ? note.text : 'Log a few more workouts and Zen will start noticing patterns.'}
      </p>
      <span className="text-[13px] font-bold text-accent">Ask Zen</span>
    </Card>
  );
}
