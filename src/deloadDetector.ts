import type { Workout } from './types';
import { collectExerciseSessions } from './progression';
import type { LoggedSet } from './progression';

export interface DeloadSuggestion {
  recommend: boolean;
  /** Target total volume for the next 7 days if we recommend a deload. */
  targetVolume: number;
  /** Rolling weekly volumes, newest last. Useful for a small chart. */
  weeklyVolumes: number[];
  /** How many consecutive weeks of volume increase we've seen. */
  risingStreak: number;
}

const WEEKS = 4; // look at last 4 weeks
const MIN_RISING_STREAK = 3;

/** How much of the usual load a deload week asks for. */
export const DELOAD_FRACTION = 0.6;
/** The one weight step we round targets to, kg — the smallest plate pair. */
const STEP_KG = 2.5;
/** Reps to aim for when history has no rep count to copy. */
export const DELOAD_DEFAULT_REPS = 8;

/** "12,400 kg" — a number a lifter can picture, not "12.4k". */
export function formatVolumeKg(kg: number): string {
  return `${Math.round(kg).toLocaleString('en-IN')} kg`;
}

/** The question the "Ask Zen" buttons hand the chat composer. */
export function deloadZenPrompt(risingStreak: number): string {
  return `My training volume has risen ${risingStreak} weeks in a row and the app suggests a deload week. `
    + 'Explain what that means for me and how to run it.';
}

/**
 * History with deliberately-light weeks taken out.
 *
 * A deload week is planned easy training, so counting it in a trend,
 * a personal best or a "vs last time" comparison reads as a slump the
 * lifter did not have. Those sessions are still real workouts — they
 * keep counting for streaks, totals, history and the calendar. This
 * filter is only for the analytics that compare one week to another.
 */
export function excludeDeloadWorkouts<T extends { deload?: boolean }>(workouts: readonly T[]): T[] {
  return workouts.filter((w) => !w.deload);
}

function weekKey(date: Date): number {
  // # of 7-day windows ago (0 = this week)
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (7 * 86400000));
}

/**
 * Scan the last ~N weeks of completed workouts and recommend a deload
 * if total weekly volume has strictly increased for `MIN_RISING_STREAK`
 * or more consecutive weeks. The suggested target is 60 % of the most
 * recent week.
 *
 * Deload weeks are left out of the buckets, so an easy week never reads
 * as a drop — and never sets up a fresh "rising streak" the moment the
 * lifter climbs back to normal.
 */
export function computeDeloadSuggestion(workouts: Workout[]): DeloadSuggestion {
  const buckets: number[] = new Array(WEEKS).fill(0);
  for (const w of excludeDeloadWorkouts(workouts)) {
    if (!w.completed || w.type === 'rest') continue;
    const wk = weekKey(new Date(w.date));
    if (wk < 0 || wk >= WEEKS) continue;
    let v = 0;
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        if (s.completed) v += s.weight * s.reps;
      }
    }
    buckets[wk] += v;
  }
  // Reorder so weeklyVolumes[0] is the oldest in the window, last is
  // the current week (same shape as a line chart left→right).
  const weekly = buckets.slice().reverse();

  let risingStreak = 0;
  for (let i = weekly.length - 1; i > 0; i--) {
    if (weekly[i] > weekly[i - 1]) risingStreak++;
    else break;
  }

  const latest = weekly[weekly.length - 1] || 0;
  return {
    recommend: risingStreak >= MIN_RISING_STREAK && latest > 0,
    targetVolume: Math.round(latest * DELOAD_FRACTION),
    weeklyVolumes: weekly,
    risingStreak,
  };
}

/* ------------------------------------------------------------------ *
 * The deload week itself
 * ------------------------------------------------------------------ */

/** Device-local: ISO time the running deload week ends. Absent = none. */
const DELOAD_UNTIL_KEY = 'zenith_deload_until';
const DELOAD_WEEK_MS = 7 * 86400000;

/**
 * Start a deload week on this device. Workouts started while it runs are
 * stamped `deload: true`, which is what keeps them out of the analytics.
 * Device-local on purpose: it is a decision about the next seven days of
 * training, not a profile setting worth syncing.
 */
export function startDeloadWeek(now: Date = new Date()): void {
  try { localStorage.setItem(DELOAD_UNTIL_KEY, new Date(now.getTime() + DELOAD_WEEK_MS).toISOString()); }
  catch { /* private mode — the week just won't stick */ }
}

/** When the running deload week ends, or null if none is running. */
export function deloadWeekEndsAt(now: Date = new Date()): Date | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(DELOAD_UNTIL_KEY); } catch { return null; }
  if (!raw) return null;
  const until = new Date(raw);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return null;
  return until;
}

export function isDeloadWeekActive(now: Date = new Date()): boolean {
  return deloadWeekEndsAt(now) !== null;
}

/** End it early. Workouts already stamped `deload` keep that stamp. */
export function endDeloadWeek(): void {
  try { localStorage.removeItem(DELOAD_UNTIL_KEY); } catch { /* nothing to clear */ }
}

/**
 * What to lift today on one exercise during a deload week: 60 % of the
 * best set of the last three sessions, rounded to the nearest 2.5 kg, for
 * the same reps as that set. Deload sessions are excluded from the lookup
 * (via `collectExerciseSessions`) so a second easy week backs off from
 * normal training rather than from the first easy week.
 *
 * Null when the exercise has never been logged — we have nothing to scale.
 */
export function deloadTargetFor(
  exerciseId: string,
  exerciseName: string | undefined,
  workouts: readonly Workout[],
): { weight: number; reps: number } | null {
  const sessions = collectExerciseSessions(workouts, exerciseId, exerciseName, 3);

  let best: LoggedSet | null = null;
  for (const s of sessions) {
    for (const set of s.sets) {
      if (!best || set.weight * set.reps > best.weight * best.reps) best = set;
    }
  }
  if (!best) return null;

  const reps = best.reps > 0 ? best.reps : DELOAD_DEFAULT_REPS;
  // Bodyweight work has no load to cut — keep it at bodyweight rather than
  // inventing a 2.5 kg pull-up.
  if (best.weight <= 0) return { weight: 0, reps };

  const weight = Math.max(STEP_KG, Math.round((best.weight * DELOAD_FRACTION) / STEP_KG) * STEP_KG);
  return { weight, reps };
}
