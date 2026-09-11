import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { getZenDailyNote } from '../../zen';
import { Card, Pill, CAPTION } from '../../ui';
import { PremiumBadge, UpgradeSheet, usePremium } from '../../premium';

interface ZenCardProps {
  /** Opens Zen chat, optionally pre-filling the composer with the daily
   *  note's follow-up prompt. */
  onAskZen: (prompt?: string) => void;
  /** Home-tab placement: tighter copy, and the card renders nothing at
   *  all when there's no note (docs/REVAMP_SPEC.md §6 UI paragraph). */
  compact?: boolean;
  /** Lets the locked card offer "I have a gym code". */
  onJoinGym?: () => void;
}

/**
 * Zen daily-note card — Health tab (always) and Home tab (only when a
 * note exists). Deterministic: `getZenDailyNote()` reads the same
 * rule-based Coach insights `InsightsView` shows, no LLM call.
 */
export function ZenCard({ onAskZen, compact, onJoinGym }: ZenCardProps) {
  const note = useMemo(() => getZenDailyNote(), []);
  const { can, ready } = usePremium();
  const [showUpgrade, setShowUpgrade] = useState(false);
  if (compact && !note) return null;

  // A free account sees what Zen is and how to get it — not a coach that
  // answers with a paywall. Home stays quiet about it (no compact lock).
  if (ready && !can('zen')) {
    if (compact) return null;
    return (
      <>
        <Card onClick={() => setShowUpgrade(true)} className="text-left">
          <div className="flex items-center justify-between mb-1">
            <span className={CAPTION}>Zen</span>
            <Pill tone="neutral" icon={Lock}>Premium</Pill>
          </div>
          <p className="text-sm text-text mb-2 line-clamp-2">
            A coach that reads your training, food and sleep and answers in plain words.
          </p>
          <span className="text-[13px] font-bold text-accent">See what Premium includes</span>
        </Card>
        <UpgradeSheet open={showUpgrade} onClose={() => setShowUpgrade(false)} feature="zen" onJoinGym={onJoinGym} />
      </>
    );
  }

  return (
    <Card onClick={() => onAskZen(note?.prompt)} className="text-left">
      {!compact && (
        <div className="flex items-center justify-between mb-1">
          <span className={CAPTION}>Zen</span>
          <PremiumBadge />
        </div>
      )}
      <p className={`text-sm text-text mb-2 ${compact ? 'line-clamp-1' : 'line-clamp-2'}`}>
        {note ? note.text : 'Log a few more workouts and Zen will start noticing patterns.'}
      </p>
      <span className="text-[13px] font-bold text-accent">Ask Zen</span>
    </Card>
  );
}
