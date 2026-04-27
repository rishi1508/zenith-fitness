import type { CoachReport } from '../coachService';
import { findFormCues } from '../coachFormCues';

/**
 * System-prompt builder. The prompt is the single most important knob
 * for tuning the LLM to act as a coach within Zenith — it's where we
 * inject the user's actual training context (rule-based insights,
 * weekly summary, top lifts) so responses are grounded, not generic.
 *
 * Tradeoffs we're making in the prompt:
 *   - SHORT replies (2–4 paragraphs). Long LLM dumps are unreadable on
 *     mobile and chew through free-tier quota.
 *   - CITE the user's data. Generic advice is what every other fitness
 *     app does; specificity is the moat.
 *   - METRIC + India context. kg, INR, common Indian gym equipment.
 *   - DEFER on medical / pain. Recommend professionals.
 *   - REFUSE non-fitness topics — keeps free-tier quota from being
 *     burned on essay-writing requests.
 *
 * If the user mentions a known exercise we additionally inject form
 * cues for that lift — cheaper / more reliable than hoping the model
 * remembers.
 */

const COACH_PERSONA = `You are an experienced strength training coach embedded in the Zenith Fitness app — a personal workout tracker used by a single user. Your job is to give practical, evidence-based, specific coaching advice grounded in their actual training data.

Style:
- Direct and concise. 2–4 short paragraphs unless the user asks for depth. No motivational filler, no emoji.
- Reference the user's actual numbers, exercises, and recent insights when relevant.
- Use kg by default. Indian gym context: assume access to barbells, dumbbells, common machines, no exotic equipment unless the user mentions it.
- Programming defaults: 3–5 reps for strength, 6–12 for hypertrophy, 12–20 for muscular endurance / accessories. Deload every 4–8 weeks of accumulated load.

Boundaries:
- If the user asks about pain, injury, or medical conditions: recommend a doctor / physiotherapist. Do not diagnose. You may offer general "common modifications when X feels off" guidance, but never specific medical advice.
- If asked about supplements, drugs, or PEDs beyond standard whey/creatine/caffeine: keep advice minimal and recommend speaking to a registered dietician or doctor.
- Refuse politely if asked about anything unrelated to fitness, training, or recovery. Free-tier quota is finite and the user opened the chat for coaching.

If the user asks something specific and you genuinely don't know, say so. Don't fabricate sources, anatomy, or studies.`;

export function buildSystemPrompt(opts: {
  userName?: string | null;
  report: CoachReport;
  todayISO: string;
  /** The user's latest message — used to detect exercise mentions and
   *  inject targeted form cues so the LLM has good reference data. */
  latestUserMessage?: string;
}): string {
  const { userName, report, todayISO, latestUserMessage } = opts;
  const greeting = userName ? `You are speaking with ${userName}.` : '';
  const weekly = report.weekly;

  const stats = [
    `- This week so far: ${weekly.sessions} session${weekly.sessions === 1 ? '' : 's'}, ${formatVolume(weekly.volume)} kg total volume.`,
  ];
  if (Math.abs(weekly.volumeDelta) > 0) {
    const sign = weekly.volumeDelta > 0 ? '+' : '−';
    stats.push(`- Volume change vs last week: ${sign}${formatVolume(Math.abs(weekly.volumeDelta))} kg.`);
  }
  if (weekly.prsThisWeek > 0) {
    stats.push(`- New personal records this week: ${weekly.prsThisWeek}.`);
  }
  // 8-week trend
  if (weekly.weeklyVolumes.length >= 4) {
    const trend = weekly.weeklyVolumes.slice(-4).map(formatVolume).join(' → ');
    stats.push(`- Last 4 weeks volume (kg): ${trend}.`);
  }

  const insightsBlock = report.insights.length > 0
    ? report.insights.slice(0, 6).map((i) => `- [${i.severity}] ${i.title}. ${i.body}`).join('\n')
    : '- (No active rule-based insights — training looks balanced and in-range.)';

  // Form cues injection — match against the latest user message so
  // questions about a specific lift get reference cues alongside.
  let formCuesBlock = '';
  if (latestUserMessage) {
    const matched = findFormCues(latestUserMessage);
    if (matched) {
      const cues = matched.cues.map((c) => `  • ${c}`).join('\n');
      formCuesBlock = `\n\nReference form cues for ${matched.name} (use if relevant, do not parrot all of them):\n${cues}`;
    }
  }

  return `${COACH_PERSONA}

Today's date (user's local): ${todayISO}.
${greeting}

== User's training context ==
${stats.join('\n')}

Active coaching insights (computed by Zenith's rule-based engine over the user's local data):
${insightsBlock}${formCuesBlock}

When you give advice, cite specific exercises and numbers from this context where possible. If the user asks something the context doesn't cover, ask one focused clarifying question rather than guessing.`;
}

/** First-load suggestions surfaced as quick-tap chips. Curated to
 *  showcase what the LLM does well with the user's data. */
export function quickPrompts(report: CoachReport): string[] {
  const out: string[] = [];

  // Insight-driven prompts get top billing — they're the most data-grounded.
  for (const ins of report.insights.slice(0, 3)) {
    if (ins.kind === 'plateau') out.push(`How do I break through my ${ins.tag || 'lift'} plateau?`);
    else if (ins.kind === 'volume-imbalance') out.push(`How do I fix my ${ins.tag || 'volume'} imbalance?`);
    else if (ins.kind === 'muscle-neglected') out.push(`Plan a ${ins.tag || 'session'} workout for tomorrow.`);
    else if (ins.kind === 'regression') out.push(`Why might ${ins.tag || 'my lift'} be going down?`);
  }
  // General fallbacks — always available.
  out.push('Review my last week of training.');
  out.push('Suggest accessories for my weakest area.');
  out.push('How should I structure a deload?');
  // Dedup + cap
  return Array.from(new Set(out)).slice(0, 4);
}

function formatVolume(kg: number): string {
  if (kg >= 100_000) return Math.round(kg / 1000).toLocaleString() + 'k';
  if (kg >= 10_000) return (kg / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.round(kg).toLocaleString();
}
