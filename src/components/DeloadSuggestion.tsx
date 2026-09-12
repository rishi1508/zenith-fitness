import { useState } from 'react';
import { Info, MessageCircle, TrendingDown, X } from 'lucide-react';
import type { DeloadSuggestion as DeloadData } from '../deloadDetector';
import { deloadZenPrompt, formatVolumeKg } from '../deloadDetector';
import { Button, IconButton, Sheet, CAPTION } from '../ui';

interface DeloadSuggestionProps {
  data: DeloadData;
  /** No longer read — the card is on theme tokens now. Safe to drop. */
  isDark?: boolean;
  /** Opens Zen with the question already typed. Hidden when absent. */
  onAskZen?: (prompt: string) => void;
  /** Starts the deload week (App stamps the next workouts `deload: true`). */
  onStartDeload?: () => void;
}

const DISMISS_KEY_PREFIX = 'zenith_deload_dismissed_';

/**
 * What a deload is, why it was suggested for THIS lifter, and what the week
 * will feel like. Shown from the "i" on the home banner and from the banner
 * at the top of a deload workout, so both places say the same thing.
 */
export function DeloadExplainerSheet({ open, onClose, data }: {
  open: boolean;
  onClose: () => void;
  data: DeloadData;
}) {
  const weeks = data.weeklyVolumes;
  const from = weeks[weeks.length - 1 - data.risingStreak];
  const to = weeks[weeks.length - 1];
  const showNumbers = data.risingStreak >= 2 && !!from && !!to && to > from;

  return (
    <Sheet open={open} onClose={onClose} title="Why an easy week helps">
      <div className="space-y-3 text-sm leading-[22px] text-muted">
        <p>
          A deload is one planned easy week. You train on the same days and do the
          same lifts, but with lighter weight and a couple of reps left in the tank
          on every set. Nothing you have built goes away in seven days.
        </p>
        <p>
          {showNumbers ? (
            <>
              You have lifted more every week for {data.risingStreak} weeks running —
              from about {formatVolumeKg(from)} a week up to {formatVolumeKg(to)}.
              That climb is what makes you stronger, but it also piles up fatigue in
              your joints, tendons and nervous system faster than rest days clear it.
              A week of that fatigue lifting off is usually what turns the work into
              actual strength.
            </>
          ) : (
            <>
              Your weekly load has been climbing for a while. That climb is what makes
              you stronger, but it also piles up fatigue in your joints, tendons and
              nervous system faster than rest days clear it. A week of that fatigue
              lifting off is usually what turns the work into actual strength.
            </>
          )}
        </p>
        <p>
          For the next seven days the app will show a lighter target on every
          exercise — roughly 60 % of your usual weight for the same reps. It will
          feel too easy, and that is the point. These sessions still count as
          workouts and still keep your streak, but they stay out of your trend
          charts and personal bests, so a deliberate easy week never looks like a
          step backwards.
        </p>
      </div>
    </Sheet>
  );
}

/**
 * Home banner when the lifter has been ramping volume for 3+ consecutive
 * weeks. Dismiss is sticky for the current calendar week so we don't
 * re-prompt them every time they open the app.
 */
export function DeloadSuggestion({ data, onAskZen, onStartDeload }: DeloadSuggestionProps) {
  const weekStamp = getWeekStamp();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY_PREFIX + weekStamp) === '1'; }
    catch { return false; }
  });
  const [explainerOpen, setExplainerOpen] = useState(false);

  if (!data.recommend || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY_PREFIX + weekStamp, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div className="bg-surface border border-info/35 rounded-card p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-control bg-info/14 text-info flex items-center justify-center shrink-0">
          <TrendingDown className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <span className={CAPTION}>Your training</span>
          <p className="text-sm font-bold text-text mt-0.5">Time for an easy week</p>
          <p className="text-[13px] leading-[18px] text-muted mt-1">
            You have lifted more {data.risingStreak} weeks in a row. A deload — one
            planned easy week — lets your body catch up so you come back stronger.
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconButton
            icon={Info}
            label="Why this?"
            size="sm"
            onClick={() => setExplainerOpen(true)}
          />
          <button
            onClick={dismiss}
            className="w-9 h-9 rounded-control flex items-center justify-center text-subtle hover:text-text transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        {onStartDeload && (
          <Button variant="primary" size="md" onClick={onStartDeload} className="flex-1 min-w-0">
            Plan a deload week
          </Button>
        )}
        {onAskZen && (
          <Button
            variant="secondary"
            size="md"
            icon={MessageCircle}
            onClick={() => onAskZen(deloadZenPrompt(data.risingStreak))}
            className={onStartDeload ? 'shrink-0' : 'flex-1'}
          >
            Ask Zen
          </Button>
        )}
      </div>

      <DeloadExplainerSheet open={explainerOpen} onClose={() => setExplainerOpen(false)} data={data} />
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
