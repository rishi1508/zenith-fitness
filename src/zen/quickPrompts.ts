import { buildExtendedContext } from '../coachService';

/**
 * Three data-aware opening prompts for Zen's empty-thread state.
 * Moved from the old BYOK coach's `src/llm/prompts.ts` (trimmed to 3 —
 * Zen's UI only shows a handful before the composer gets crowded).
 * Insight-driven prompts come first since they're the most grounded in
 * real data; a PR prompt and generic fallbacks fill any remaining
 * slots.
 */
export function quickPrompts(): string[] {
  const ctx = buildExtendedContext();
  const out: string[] = [];

  for (const ins of ctx.report.insights.slice(0, 3)) {
    if (ins.kind === 'plateau') out.push(`How do I break through my ${ins.tag || 'lift'} plateau?`);
    else if (ins.kind === 'volume-imbalance') out.push(`How do I fix my ${ins.tag || 'volume'} imbalance?`);
    else if (ins.kind === 'muscle-neglected') out.push(`Plan a ${ins.tag || 'session'} workout for tomorrow.`);
    else if (ins.kind === 'regression') out.push(`Why might ${ins.tag || 'my lift'} be going down?`);
    else if (ins.kind === 'goal-pacing-lift') out.push(`What should I do to keep ${ins.tag || 'this lift'} progressing?`);
  }

  if (ctx.personalRecords.length > 0 && out.length < 3) {
    out.push(`Should I attempt a new PR on ${ctx.personalRecords[0].exerciseName} this week?`);
  }
  out.push('Review my last week of training.');
  out.push('How should I structure a deload?');

  return Array.from(new Set(out)).slice(0, 3);
}
