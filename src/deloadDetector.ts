import type { Workout } from './types';

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
 */
export function computeDeloadSuggestion(workouts: Workout[]): DeloadSuggestion {
  const buckets: number[] = new Array(WEEKS).fill(0);
  for (const w of workouts) {
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
    targetVolume: Math.round(latest * 0.6),
    weeklyVolumes: weekly,
    risingStreak,
  };
}
