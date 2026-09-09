import type { DayPlan, WeeklyPlan, Workout } from './types';
import { localIso, weekStartISO } from './streakService';

/**
 * Which day of the plan to offer next.
 *
 * A weekly plan is a cycle, not a calendar: the days are meant to be done in
 * order, once each, within the week. So the answer is always "the earliest
 * day of this week's cycle you have not done yet" — which gives both of the
 * behaviours a lifter expects without needing two rules:
 *
 *   - finish Day 1 → Day 2 is the earliest one left, so that is what is
 *     offered;
 *   - skip ahead and do Day 3 → Day 1 and Day 2 are still the earliest ones
 *     left, so the plan pulls you back to them rather than marching on.
 *
 * When the whole cycle is done the next round starts at the first day again.
 * Rest days are never suggested.
 *
 * Pure — `src/views/tabs/HomeTabView.tsx` supplies the plan and the history.
 */

export interface DaySuggestion {
  day: DayPlan;
  /** One short line for the card: why this day. */
  reason: string;
  /** Days of the cycle already done this week. */
  doneCount: number;
  /** Non-rest days in the cycle. */
  totalCount: number;
  /** True when the cycle is complete and this is the start of the next one. */
  cycleComplete: boolean;
}

/** A workout belongs to a plan day when its name ends with that day's name —
 *  the same convention `startWorkout` uses ("<plan> - <day>"). */
export function matchesDay(workout: Workout, day: DayPlan): boolean {
  const name = workout.name.trim().toLowerCase();
  const dayName = day.name.trim().toLowerCase();
  return name === dayName || name.endsWith(` - ${dayName}`) || name.endsWith(`- ${dayName}`);
}

/** Plan days completed since `weekStart` (inclusive), by dayNumber. */
export function daysDoneThisWeek(plan: WeeklyPlan, workouts: readonly Workout[], now: Date = new Date()): Set<number> {
  const start = weekStartISO(now);
  const done = new Set<number>();
  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    if (localIso(new Date(w.date)) < start) continue;
    const day = plan.days.find((d) => !d.isRestDay && matchesDay(w, d));
    if (day) done.add(day.dayNumber);
  }
  return done;
}

export function suggestNextDay(
  plan: WeeklyPlan | null,
  workouts: readonly Workout[],
  now: Date = new Date(),
): DaySuggestion | null {
  if (!plan) return null;
  const cycle = plan.days.filter((d) => !d.isRestDay).sort((a, b) => a.dayNumber - b.dayNumber);
  if (cycle.length === 0) return null;

  const done = daysDoneThisWeek(plan, workouts, now);
  const pending = cycle.filter((d) => !done.has(d.dayNumber));
  const totalCount = cycle.length;
  const doneCount = totalCount - pending.length;

  if (pending.length === 0) {
    return {
      day: cycle[0],
      reason: `Every day of ${plan.name} is done this week. ${cycle[0].name} starts the next round.`,
      doneCount,
      totalCount,
      cycleComplete: true,
    };
  }

  const next = pending[0];
  // Was anything *after* this day already done? Then the user jumped ahead and
  // this one is owed, which is worth saying out loud.
  const skippedAhead = [...done].some((n) => n > next.dayNumber);
  return {
    day: next,
    reason: skippedAhead
      ? `${next.name} is still pending from this week.`
      : doneCount === 0
        ? `First session of ${plan.name} this week.`
        : `${doneCount} of ${totalCount} done this week — ${next.name} is next.`,
    doneCount,
    totalCount,
    cycleComplete: false,
  };
}
