import { buildCoachReport } from '../coachService';
import type { CoachReport, Insight } from '../coachService';

/**
 * `getZenDailyNote()` — the single highest-severity insight from the
 * deterministic Coach (`coachService.buildCoachReport()`), phrased as
 * one sentence plus a follow-up "Ask Zen" prompt. No LLM call (spec §6).
 */

export interface ZenDailyNote {
  insightId: string;
  severity: Insight['severity'];
  /** One-sentence phrasing of the top insight. */
  text: string;
  /** Suggested opening question for "Ask Zen". */
  prompt: string;
}

export function getZenDailyNote(report: CoachReport = buildCoachReport()): ZenDailyNote | null {
  if (!report.hasEnoughData || report.insights.length === 0) return null;
  // insights are already sorted by severity then priority (coachService.rankInsights).
  const top = report.insights[0];
  return {
    insightId: top.id,
    severity: top.severity,
    text: oneSentence(top),
    prompt: followUpPrompt(top),
  };
}

/** Title + the first clause of the body, as one sentence — the body can
 *  run to several sentences of sub-options, which is right for the full
 *  Coach view but too much for a one-line daily note. */
function oneSentence(insight: Insight): string {
  const firstClause = insight.body.split(/(?<=[.!?])\s+/)[0]?.trim() || insight.body.trim();
  const clause = firstClause.replace(/[.!?]+$/, '');
  return clause ? `${insight.title} — ${clause}.` : `${insight.title}.`;
}

function followUpPrompt(insight: Insight): string {
  const tag = insight.tag;
  switch (insight.kind) {
    case 'plateau': return `How do I break through my ${tag || 'lift'} plateau?`;
    case 'regression': return `Why might ${tag || 'my lift'} be going down?`;
    case 'progression': return `How do I keep progressing on ${tag || 'this lift'}?`;
    case 'volume-imbalance': return `How do I fix my ${tag || 'volume'} imbalance?`;
    case 'muscle-neglected': return `Plan a ${tag || 'session'} workout for tomorrow.`;
    case 'muscle-on-pace': return `What should I do to keep ${tag || 'this'} on pace?`;
    case 'frequency-low': return 'How do I get back on track this week?';
    case 'frequency-strong': return 'Am I at risk of overtraining?';
    case 'recent-deload': return 'Should I keep deloading or ramp back up?';
    case 'goal-pacing-bw': return 'Is my weight trend on track?';
    case 'goal-pacing-lift': return `What should I do to keep ${tag || 'this lift'} progressing?`;
    case 'next-workout': return 'What should I focus on in my next session?';
    case 'pr-celebration': return "What's next after this PR?";
    case 'rest-overdue': return 'Do I need a deload?';
    default: return 'Tell me more about this.';
  }
}
