import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { buildCoachReport } from '../coachService';
import type { Insight } from '../coachService';
import { Card, Button, CAPTION } from '../ui';
import { UpgradeSheet, usePremium } from '../premium';

interface Props {
  /** Opens Zen with the composer pre-filled — the same prop Home already
   *  hands to `ZenCard`. */
  onOpenZen: (prompt?: string) => void;
  /** Gym join screen, offered inside the upgrade sheet. */
  onJoinGym?: () => void;
}

/**
 * "Insights" — the first card on Home.
 *
 * Reads the deterministic Coach report (src/coachService.ts, no LLM call)
 * and states the one thing worth fixing, with a one-tap handoff to Zen
 * carrying the insight as the opening question. A free account still reads
 * the insight; only the Zen tap hits the paywall, exactly as `ZenCard`
 * does. Renders nothing until the Coach has enough history to speak, so a
 * new account never sees an empty shell.
 */
export function HomeInsightsCard({ onOpenZen, onJoinGym }: Props) {
  const report = useMemo(() => buildCoachReport(), []);
  const { can, ready } = usePremium();
  const [showUpgrade, setShowUpgrade] = useState(false);

  // insights are pre-sorted by severity then priority (coachService.rankInsights).
  const [top, second] = report.insights;
  if (!report.hasEnoughData || !top) return null;

  const locked = ready && !can('zen');

  return (
    <>
      <Card>
        <span className={CAPTION}>Insights</span>
        <p className="text-[15px] leading-5 font-semibold text-text mt-1.5">{top.title}</p>
        <p className="text-[13px] leading-[18px] text-muted mt-1">{firstSentence(top.body)}</p>
        {second && (
          <p className="text-[13px] leading-[18px] text-subtle mt-2 line-clamp-1">Also: {second.title}</p>
        )}
        <Button
          variant="secondary" size="sm" icon={Sparkles} className="mt-3"
          onClick={() => (locked ? setShowUpgrade(true) : onOpenZen(askPrompt(top)))}
        >
          Ask Zen
        </Button>
      </Card>
      <UpgradeSheet open={showUpgrade} onClose={() => setShowUpgrade(false)} feature="zen" onJoinGym={onJoinGym} />
    </>
  );
}

/** The Coach body can run to several sentences of sub-options — right for
 *  the Insights screen, too much for one home card. */
function firstSentence(text: string): string {
  return text.split(/(?<=[.!?])\s+/)[0]?.trim() || text.trim();
}

function askPrompt(insight: Insight): string {
  const clause = firstSentence(insight.body).replace(/[.!?]+$/, '');
  const what = lowerFirst(insight.title);
  return `My last 4 weeks show ${what}${clause ? ` — ${clause}` : ''}. What should I change this week?`;
}

/** Titles are sentence case, so they need a lower-case first letter mid-
 *  sentence — unless the word is an acronym ("PR on bench"). */
function lowerFirst(s: string): string {
  const second = s[1];
  if (second && second === second.toUpperCase() && second !== second.toLowerCase()) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}
