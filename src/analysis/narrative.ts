import { askZen } from '../zen/client';
import type { AskZenOptions, AskZenResult } from '../zen/client';
import { capChars, fmtShort, fmtVolume, num, signed } from '../zen/format';
import { localIso } from '../streakService';
import type { AnalysisReport, AnalysisWindow } from './engine';

/**
 * The coach's read — one short narrative over the numbers the engine
 * already computed, written by Zen.
 *
 * Two rules hold the cost down:
 *   1. Zen is sent NUMBERS, never raw workouts. The context below is a
 *      summary of a summary, capped at {@link MAX_CONTEXT_CHARS}, so the
 *      bill does not grow with the length of someone's training history.
 *   2. One call per window per day. The answer is cached under
 *      `zenith_analysis_narrative_<window>_<YYYY-MM-DD>`; opening the
 *      screen again the same day reads the cache, and only the explicit
 *      Refresh bypasses it.
 *
 * The numeric analysis never waits on this and never fails with it — the
 * screen renders in full before the first token arrives.
 */

export const NARRATIVE_KEY_PREFIX = 'zenith_analysis_narrative_';

/** The brief itself is small; the cap is a backstop against a freak history. */
const MAX_CONTEXT_CHARS = 2000;

export interface CachedNarrative {
  text: string;
  /** ISO timestamp the answer was written. */
  at: string;
  model?: string;
}

export interface NarrativeResult extends CachedNarrative {
  /** True when it came from today's cache rather than a fresh call. */
  cached: boolean;
}

export function narrativeCacheKey(window: AnalysisWindow, now: Date = new Date()): string {
  return `${NARRATIVE_KEY_PREFIX}${window}_${localIso(now)}`;
}

/** Today's cached read-out for this window, or null. Yesterday's key is a
 *  miss by construction — the date is part of the key. */
export function readNarrativeCache(window: AnalysisWindow, now: Date = new Date()): CachedNarrative | null {
  try {
    const raw = localStorage.getItem(narrativeCacheKey(window, now));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedNarrative;
    return typeof parsed?.text === 'string' && parsed.text ? parsed : null;
  } catch {
    return null;
  }
}

/** Writes today's answer and drops every older one — three windows a day
 *  would otherwise pile up in localStorage forever. */
export function writeNarrativeCache(window: AnalysisWindow, entry: CachedNarrative, now: Date = new Date()): void {
  const key = narrativeCacheKey(window, now);
  try {
    localStorage.setItem(key, JSON.stringify(entry));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NARRATIVE_KEY_PREFIX) && !k.endsWith(`_${localIso(now)}`)) localStorage.removeItem(k);
    }
  } catch { /* private mode or quota — the read-out just won't be cached */ }
}

/**
 * The numbers, as one compact brief. Everything here is already rounded
 * and labelled: Zen's job is to read it, not to do arithmetic.
 */
export function buildNarrativeContext(report: AnalysisReport): string {
  const { load, consistency, strength, balance, recovery } = report;
  const lines: string[] = [];

  lines.push(
    `Analysis window: ${report.label.toLowerCase()}${report.from ? ` (${report.from} to ${report.to})` : ''}, ${report.sessions} sessions. Units: kg.`,
  );

  lines.push(
    `Load: ${fmtVolume(load.totalVolume)} kg lifted, ${num(load.sessionsPerWeek)} sessions/week`
    + `${load.avgDurationMin ? `, ${load.avgDurationMin} min average session` : ''}.`
    + ` Weekly volume ${load.trend.direction}${load.trend.changePct != null ? ` (${signed(load.trend.changePct)}%, older half ${fmtVolume(load.trend.firstHalf)} kg vs newer half ${fmtVolume(load.trend.secondHalf)} kg)` : ''}.`,
  );
  lines.push(`Weekly volume oldest to newest (kg): ${load.weeks.map((w) => Math.round(w.volume)).join(', ')}.`);

  lines.push(
    `Consistency: ${consistency.adherencePct}% of a ${consistency.commitment} day/week commitment over ${consistency.weeksCounted} finished week${consistency.weeksCounted === 1 ? '' : 's'}`
    + ` (${consistency.trainingDays} training days, ${consistency.weeksMet} weeks hit the target).`
    + ` Longest gap ${consistency.longestGapDays} days.`
    + `${consistency.daysSinceLast != null ? ` Last session ${consistency.daysSinceLast} day${consistency.daysSinceLast === 1 ? '' : 's'} ago.` : ''}`
    + `${consistency.topDays.length ? ` Usually trains ${consistency.topDays.map((d) => d.label).join(', ')}.` : ''}`,
  );

  if (strength.exercises.length) {
    lines.push('Estimated 1RM (Epley) per exercise, first to latest in window:');
    for (const ex of strength.exercises) {
      lines.push(
        `- ${ex.name}: ${ex.sessions} sessions, ${num(ex.first)} to ${num(ex.latest)} kg`
        + `${ex.changePct != null ? ` (${signed(ex.changePct)}%)` : ''}, best ${num(ex.best)} kg,`
        + ` ${ex.sessionsSinceBest} session${ex.sessionsSinceBest === 1 ? '' : 's'} since that best${ex.plateau ? ', plateau' : ''}.`,
      );
    }
  }
  if (strength.prs.length) {
    lines.push(
      `Personal bests in window: ${strength.prs.length} (${strength.prs.slice(0, 3).map((p) => `${p.name} ${num(p.weight)} kg x ${p.reps} on ${fmtShort(p.date)}`).join('; ')}).`,
    );
  }

  if (balance.groups.length) {
    lines.push(`Volume share by muscle group: ${balance.groups.map((g) => `${g.label} ${Math.round(g.share)}%`).join(', ')}.`);
    lines.push(`Push ${fmtVolume(balance.push)} kg vs pull ${fmtVolume(balance.pull)} kg.`);
  }
  for (const flag of balance.flags) lines.push(`Balance flag: ${flag.title} — ${flag.detail}`);

  lines.push(
    `Recovery: volume rising ${recovery.risingStreak} week${recovery.risingStreak === 1 ? '' : 's'} in a row`
    + `${recovery.recommendDeload ? '; a lighter week is suggested' : ''}.`
    + `${recovery.lightSessions.length ? ` ${recovery.lightSessions.length} session${recovery.lightSessions.length === 1 ? '' : 's'} came in well under the usual load for their exercises.` : ''}`,
  );

  if (report.actionables.length) {
    lines.push('Actions the app already ranked:');
    report.actionables.forEach((a, i) => lines.push(`${i + 1}. ${a.title} — ${a.detail}`));
  }

  return capChars(lines.join('\n'), MAX_CONTEXT_CHARS);
}

/** The one thing we ask for. Length is stated twice because a coach that
 *  runs long is a coach nobody reads. */
export const NARRATIVE_QUESTION =
  'Read the analysis in my context and write my coach read-out. 120 to 180 words, plain words a gym-goer understands, no lists of numbers I can already see. '
  + 'Say what is going well, what is holding me back, and why. Then finish with exactly three actions for the next two weeks, one short line each, numbered.';

export interface FetchNarrativeOptions {
  report: AnalysisReport;
  /** Firebase ID token of the signed-in user. */
  idToken: string;
  tz?: string;
  /** Skips today's cache — the Refresh button. */
  force?: boolean;
  now?: Date;
  /** Injected in tests; defaults to the real Zen client. */
  ask?: (opts: AskZenOptions) => Promise<AskZenResult>;
}

/**
 * Today's coach read-out for this window. Throws whatever `askZen` throws
 * (a `ZenError` with a `kind` the screen turns into calm copy) — the
 * caller decides what to show; nothing here is fatal to the screen.
 */
export async function fetchNarrative(opts: FetchNarrativeOptions): Promise<NarrativeResult> {
  const now = opts.now ?? new Date();
  const window = opts.report.window;

  if (!opts.force) {
    const cached = readNarrativeCache(window, now);
    if (cached) return { ...cached, cached: true };
  }

  const ask = opts.ask ?? askZen;
  const result = await ask({
    idToken: opts.idToken,
    messages: [{ role: 'user', content: NARRATIVE_QUESTION }],
    context: buildNarrativeContext(opts.report),
    tz: opts.tz,
    // The brief above already carries every number this answer needs, so
    // there is nothing to look up — and a second round would double the cost.
    resolveData: () => '',
  });

  const entry: CachedNarrative = { text: result.text.trim(), at: now.toISOString(), model: result.model };
  writeNarrativeCache(window, entry, now);
  return { ...entry, cached: false };
}
