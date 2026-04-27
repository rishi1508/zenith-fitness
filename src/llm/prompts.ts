import type { ExtendedCoachContext } from '../coachService';
import type { Workout, BodyMeasurementEntry } from '../types';
import { findFormCues } from '../coachFormCues';

/**
 * System-prompt builder. Single most important knob for tuning the
 * LLM to act as a real coach within Zenith — it's where we inject the
 * user's full training context (recent workouts, PRs, body weight,
 * plan, streak, insights) so the model can cite their actual numbers
 * and exercises instead of giving generic advice.
 *
 * Token budget: roughly 1500–2500 tokens with a typical user history.
 * Well within Llama 3.3 70B (128k), Gemini Flash (1M), and gpt-4o
 * (128k). We trim arrays defensively in case a user has years of
 * history.
 *
 * If the user mentions a specific lift in their message, we
 * additionally inject form cues for that lift so the model has a
 * grounded reference instead of relying on its training data alone.
 */

const COACH_PERSONA = `You are an experienced strength training coach embedded in the Zenith Fitness app — a personal workout tracker for a single user. Your job is to give practical, evidence-based, specific coaching advice grounded in their ACTUAL training data, which is provided below.

Style:
- Direct and concise. 2–4 short paragraphs by default. Markdown bullets when listing things.
- ALWAYS reference the user's actual numbers, exercises, and recent insights when relevant. Generic advice is what every other fitness app gives — your edge is specificity.
- Use kg by default. Indian gym context: assume access to barbells, dumbbells, common machines, no exotic equipment unless mentioned.
- Programming defaults: 3–5 reps for strength, 6–12 for hypertrophy, 12–20 for accessories. Deload every 4–8 weeks of accumulated load.
- No motivational fluff, no emoji, no "as a coach" preamble. Get straight to the answer.

Boundaries:
- Pain or injury → recommend a doctor / physiotherapist. You can offer general "common modifications when X feels off" guidance, but never specific medical advice.
- Supplements: keep advice minimal beyond standard whey/creatine/caffeine. Recommend a registered dietician for anything more involved.
- Refuse politely if asked about anything unrelated to fitness, training, or recovery — free-tier quota is finite and the user opened this chat for coaching.

If you genuinely don't know something specific, say so — don't fabricate sources, anatomy, or studies.`;

export function buildSystemPrompt(opts: {
  userName?: string | null;
  context: ExtendedCoachContext;
  todayISO: string;
  /** Used to inject form cues for any lift the user mentions. */
  latestUserMessage?: string;
}): string {
  const { userName, context, todayISO, latestUserMessage } = opts;
  const sections: string[] = [];

  sections.push(COACH_PERSONA);
  sections.push(`Today's date (user's local): ${todayISO}.${userName ? ` You are speaking with ${userName}.` : ''}`);

  // ----- This week + 8-week trend -----
  sections.push(formatThisWeekSection(context));

  // ----- Active plan -----
  if (context.activePlan) {
    sections.push(formatPlanSection(context));
  }

  // ----- Streak -----
  sections.push(formatStreakSection(context));

  // ----- Body weight + measurements -----
  if (context.bodyWeight.current !== null) {
    sections.push(formatBodySection(context));
  }

  // ----- Personal records -----
  if (context.personalRecords.length > 0) {
    sections.push(formatPRsSection(context));
  }

  // ----- Recent workouts -----
  if (context.recentWorkouts.length > 0) {
    sections.push(formatRecentWorkoutsSection(context));
  }

  // ----- Insights -----
  sections.push(formatInsightsSection(context));

  // ----- Library overview -----
  sections.push(formatLibrarySection(context));

  // ----- Form cues if the latest message names a known lift -----
  const cuesBlock = formatFormCuesIfMatched(latestUserMessage);
  if (cuesBlock) sections.push(cuesBlock);

  sections.push(`When you give advice, cite specific exercises and numbers from the data above where possible. If the user asks about something the context doesn't cover (e.g. an exercise they've never logged), ask one focused clarifying question rather than guessing.`);

  return sections.join('\n\n');
}

// ----- Section formatters -------------------------------------------------

function formatThisWeekSection(ctx: ExtendedCoachContext): string {
  const w = ctx.report.weekly;
  const lines: string[] = [
    '== This week so far ==',
    `- Sessions: ${w.sessions}`,
    `- Volume: ${formatVolume(w.volume)} kg`,
  ];
  if (Math.abs(w.volumeDelta) > 0) {
    lines.push(`- vs last week: ${w.volumeDelta > 0 ? '+' : '−'}${formatVolume(Math.abs(w.volumeDelta))} kg`);
  }
  if (w.prsThisWeek > 0) lines.push(`- PRs hit: ${w.prsThisWeek}`);

  // 8-week sparkline summary
  if (w.weeklyVolumes.length >= 4) {
    const trail = w.weeklyVolumes.slice(-8).map(formatVolume).join(' → ');
    lines.push(`- Last weeks (kg): ${trail}`);
  }
  return lines.join('\n');
}

function formatPlanSection(ctx: ExtendedCoachContext): string {
  const plan = ctx.activePlan!;
  const lines: string[] = ['== Active plan =='];
  lines.push(`- Name: ${plan.name}`);
  const dayLines = plan.days.map((d) => {
    const tag = d.isRestDay ? 'rest' : `${d.exercises.length} ex`;
    return `  ${d.dayNumber}. ${d.name} (${tag})`;
  });
  lines.push(`- Days:`);
  lines.push(...dayLines);
  if (ctx.lastUsedDayName) {
    lines.push(`- Last completed: ${ctx.lastUsedDayName}`);
  }
  return lines.join('\n');
}

function formatStreakSection(ctx: ExtendedCoachContext): string {
  const s = ctx.streak;
  const lines: string[] = ['== Streak (weekly model) =='];
  lines.push(`- Current: ${s.currentWeeks} week${s.currentWeeks === 1 ? '' : 's'}`);
  lines.push(`- Longest: ${s.longestWeeks} week${s.longestWeeks === 1 ? '' : 's'}`);
  lines.push(`- Streak freezes available: ${s.freezesAvailable}/2`);
  if (s.freezesAvailable < 2) {
    lines.push(`- Days until next freeze earned: ${s.daysToNextFreeze}`);
  }
  lines.push(`- Total all-time non-rest workouts logged: ${ctx.totalWorkouts}`);
  return lines.join('\n');
}

function formatBodySection(ctx: ExtendedCoachContext): string {
  const bw = ctx.bodyWeight;
  const lines: string[] = ['== Body composition =='];
  lines.push(`- Body weight (latest): ${bw.current} kg`);
  if (bw.delta7d !== null) {
    lines.push(`- 7-day change: ${bw.delta7d > 0 ? '+' : ''}${bw.delta7d.toFixed(1)} kg`);
  }
  if (bw.delta30d !== null) {
    lines.push(`- 30-day change: ${bw.delta30d > 0 ? '+' : ''}${bw.delta30d.toFixed(1)} kg`);
  }
  lines.push(`- Body weight samples logged: ${bw.samples}`);
  if (ctx.latestMeasurement) {
    lines.push(`- Latest body measurements (${ctx.latestMeasurement.date.slice(0, 10)}): ${formatMeasurements(ctx.latestMeasurement)}`);
  }
  return lines.join('\n');
}

function formatPRsSection(ctx: ExtendedCoachContext): string {
  const lines = ['== Personal records (most recent first) =='];
  for (const pr of ctx.personalRecords) {
    const date = new Date(pr.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    lines.push(`- ${pr.exerciseName}: ${pr.weight} kg × ${pr.reps} (${date})`);
  }
  return lines.join('\n');
}

function formatRecentWorkoutsSection(ctx: ExtendedCoachContext): string {
  const lines = ['== Last 10 completed workouts (newest first) =='];
  for (const w of ctx.recentWorkouts) {
    lines.push(`- ${formatWorkoutLine(w)}`);
  }
  return lines.join('\n');
}

function formatWorkoutLine(w: Workout): string {
  const date = new Date(w.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const duration = w.duration ? ` (${w.duration}m)` : '';
  // Compact per-exercise summary: name + best completed set + set count.
  const exParts: string[] = [];
  for (const ex of w.exercises) {
    let topW = 0; let topR = 0; let setCount = 0;
    for (const s of ex.sets) {
      if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
      setCount++;
      if (s.weight > topW || (s.weight === topW && s.reps > topR)) {
        topW = s.weight; topR = s.reps;
      }
    }
    if (setCount > 0) {
      exParts.push(`${ex.exerciseName} ${topW}×${topR} (${setCount} set${setCount === 1 ? '' : 's'})`);
    } else {
      exParts.push(`${ex.exerciseName} (no sets)`);
    }
  }
  return `${date} — ${w.name}${duration}: ${exParts.slice(0, 6).join('; ')}${exParts.length > 6 ? '; …' : ''}`;
}

function formatInsightsSection(ctx: ExtendedCoachContext): string {
  const insights = ctx.report.insights.slice(0, 8);
  if (insights.length === 0) {
    return `== Active rule-based insights ==\n- (No active flags — training looks balanced and in-range.)`;
  }
  const lines = ['== Active rule-based insights (computed by Zenith over your local data) =='];
  for (const i of insights) {
    lines.push(`- [${i.severity}] ${i.title}. ${i.body}`);
  }
  return lines.join('\n');
}

function formatLibrarySection(ctx: ExtendedCoachContext): string {
  const groups = Object.entries(ctx.libraryByMuscleGroup);
  if (groups.length === 0) return '';
  const summary = groups
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .map(([g, n]) => `${g}: ${n}`)
    .join(', ');
  return `== Exercise library overview ==\n- Total exercises tracked, by muscle group: ${summary}`;
}

function formatFormCuesIfMatched(message?: string): string {
  if (!message) return '';
  const matched = findFormCues(message);
  if (!matched) return '';
  const cues = matched.cues.map((c) => `  • ${c}`).join('\n');
  return `== Reference form cues for ${matched.name} ==\n(Use only if relevant. Don't parrot all of them.)\n${cues}`;
}

// ----- Quick prompts (first-use suggestions) ------------------------------

export function quickPrompts(ctx: ExtendedCoachContext): string[] {
  const out: string[] = [];

  // Insight-driven prompts get top billing — they're the most data-grounded.
  for (const ins of ctx.report.insights.slice(0, 3)) {
    if (ins.kind === 'plateau') out.push(`How do I break through my ${ins.tag || 'lift'} plateau?`);
    else if (ins.kind === 'volume-imbalance') out.push(`How do I fix my ${ins.tag || 'volume'} imbalance?`);
    else if (ins.kind === 'muscle-neglected') out.push(`Plan a ${ins.tag || 'session'} workout for tomorrow.`);
    else if (ins.kind === 'regression') out.push(`Why might ${ins.tag || 'my lift'} be going down?`);
    else if (ins.kind === 'goal-pacing-lift') out.push(`What should I do to keep ${ins.tag || 'this lift'} progressing?`);
  }

  // PR-aware fallback
  if (ctx.personalRecords.length > 0 && out.length < 3) {
    const top = ctx.personalRecords[0];
    out.push(`Should I attempt a new PR on ${top.exerciseName} this week?`);
  }
  // Generic fallbacks
  out.push('Review my last week of training.');
  out.push('Suggest accessories for my weakest area.');
  out.push('How should I structure a deload?');

  return Array.from(new Set(out)).slice(0, 5);
}

// ----- Helpers ------------------------------------------------------------

function formatVolume(kg: number): string {
  if (kg >= 100_000) return Math.round(kg / 1000).toLocaleString() + 'k';
  if (kg >= 10_000) return (kg / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.round(kg).toLocaleString();
}

function formatMeasurements(m: BodyMeasurementEntry): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(m.measurements)) {
    if (typeof v === 'number') parts.push(`${k} ${v}cm`);
  }
  return parts.length > 0 ? parts.join(', ') : '(no field values)';
}
