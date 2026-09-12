import type { ExerciseEquipment, Workout } from './types';

/**
 * Progressive-overload suggestions (PRODUCT_RESEARCH Tier 1 #1).
 *
 * Deterministic, no AI, no network. Everything here is a pure function of
 * the workout history that is already in localStorage, so the active
 * workout can answer "what weight today?" without asking anyone.
 *
 * The rule, in full:
 *
 *   - Fewer than two logged sessions → show last time, suggest nothing.
 *     One data point is not a trend and a wrong nudge on day one is worse
 *     than no nudge.
 *   - Every working set last time hit or beat the target reps → step up.
 *     Barbell / machine / cable / unknown add {@link WEIGHT_STEP_KG} kg;
 *     dumbbell, kettlebell, band and bodyweight add a rep instead, because
 *     the smallest real jump on those is 2.5 kg *per hand* (or a whole
 *     body), which is far more than 2.5 % of the load.
 *   - Any working set fell short → hold the same weight until all of them
 *     land. We never suggest going down: a deload is the lifter's call.
 *
 * After the lifter backs off on their own the suggestion builds from the
 * *lighter* weight — it does not jump back to the old top set. Backing off
 * is a choice, and the app climbing straight back would undo it. A flagged
 * deload week (`workout.deload`) is the exception: those sessions are
 * planned-easy, not a new baseline, so they are skipped entirely here.
 */

/** A set as it was actually performed. `weight: 0` = bodyweight. */
export interface LoggedSet {
  weight: number;
  reps: number;
}

/** One past performance of an exercise — its completed working sets. */
export interface ExerciseSession {
  /** ISO date of the workout it came from. */
  date: string;
  sets: LoggedSet[];
}

export type SuggestionKind = 'add-weight' | 'add-rep' | 'hold';

export interface Suggestion {
  kind: SuggestionKind;
  /** Weight to aim for today, kg. */
  weight: number;
  /** Reps to aim for today. */
  reps: number;
  /** One sentence the UI can show behind a "Why?" affordance. */
  why: string;
}

export interface Progression {
  /** Completed working sets of the most recent session, in order. */
  lastSets: LoggedSet[];
  /** Heaviest set of that session (ties broken by reps); null if never logged. */
  last: LoggedSet | null;
  /** How many past sessions of this exercise the history holds. */
  sessionCount: number;
  /** Null until there are two logged sessions to compare. */
  suggestion: Suggestion | null;
}

/** The one weight step we ever suggest, in kg — the smallest plate pair. */
export const WEIGHT_STEP_KG = 2.5;

/** Equipment whose next weight is too big a jump, so reps move first. */
const REP_FIRST_EQUIPMENT: readonly ExerciseEquipment[] =
  ['dumbbell', 'bodyweight', 'kettlebell', 'band'];

/** Newest first. Workouts share a date format, so string compare is enough. */
function newestFirst(a: { date: string }, b: { date: string }): number {
  return new Date(b.date).getTime() - new Date(a.date).getTime();
}

/**
 * Past performances of one exercise, newest first. Matches on id and, for
 * workouts logged in a buddy session (which carry the host's exercise ids),
 * falls back to the name. Deload weeks are skipped — they are deliberately
 * light, so building today's target off them would drag the lifter down.
 */
export function collectExerciseSessions(
  workouts: readonly Workout[],
  exerciseId: string,
  exerciseName?: string,
  limit = 8,
): ExerciseSession[] {
  const nameKey = exerciseName?.trim().toLowerCase();
  const sessions: ExerciseSession[] = [];

  for (const workout of [...workouts].sort(newestFirst)) {
    if (!workout.completed || workout.type === 'rest' || workout.deload) continue;
    const match = workout.exercises.find((ex) =>
      ex.exerciseId === exerciseId
      || (!!nameKey && ex.exerciseName.trim().toLowerCase() === nameKey));
    if (!match) continue;
    const sets = match.sets
      .filter((s) => s.completed && s.reps > 0)
      .map((s) => ({ weight: s.weight, reps: s.reps }));
    if (sets.length === 0) continue;
    sessions.push({ date: workout.date, sets });
    if (sessions.length >= limit) break;
  }

  return sessions;
}

/** Heaviest set, ties broken by the most reps at that weight. */
export function topSet(sets: readonly LoggedSet[]): LoggedSet | null {
  let best: LoggedSet | null = null;
  for (const set of sets) {
    if (!best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps)) {
      best = set;
    }
  }
  return best;
}

/** "82.5" / "80" — never "80.0". */
export function formatKg(kg: number): string {
  return Number.isInteger(kg) ? `${kg}` : `${Math.round(kg * 10) / 10}`;
}

/** "80 kg × 5", or "Bodyweight × 12" when nothing was loaded. */
export function formatSet(set: LoggedSet): string {
  return set.weight > 0 ? `${formatKg(set.weight)} kg × ${set.reps}` : `Bodyweight × ${set.reps}`;
}

/**
 * What to aim for today. `targetReps` is the rep goal the session is
 * written around; without one we take the best set of last session as the
 * goal, so "all sets matched the best set" is what counts as a clean week.
 */
export function buildProgression({ sessions, equipment, targetReps }: {
  sessions: readonly ExerciseSession[];
  equipment?: ExerciseEquipment;
  targetReps?: number;
}): Progression {
  const last = sessions[0];
  if (!last) return { lastSets: [], last: null, sessionCount: 0, suggestion: null };

  const lastTop = topSet(last.sets);
  const base: Progression = {
    lastSets: last.sets,
    last: lastTop,
    sessionCount: sessions.length,
    suggestion: null,
  };
  // One session is a data point, not a trend.
  if (sessions.length < 2 || !lastTop) return base;

  const target = targetReps && targetReps > 0
    ? targetReps
    : last.sets.reduce((most, s) => Math.max(most, s.reps), 0);

  const missed = last.sets.some((s) => s.reps < target);
  if (missed) {
    return {
      ...base,
      suggestion: {
        kind: 'hold',
        weight: lastTop.weight,
        reps: target,
        why: `A set fell short of ${target} reps last time, so hold ${formatKg(lastTop.weight)} kg until all of them land.`,
      },
    };
  }

  // Clean session. Load moves for the equipment that has a small step;
  // everything else earns a rep first.
  const repsFirst = lastTop.weight <= 0
    || (!!equipment && REP_FIRST_EQUIPMENT.includes(equipment));

  if (repsFirst) {
    return {
      ...base,
      suggestion: {
        kind: 'add-rep',
        weight: lastTop.weight,
        reps: target + 1,
        why: `Every set hit ${target} reps last time, and the next weight up is too big a jump — take one more rep instead.`,
      },
    };
  }

  const weight = lastTop.weight + WEIGHT_STEP_KG;
  return {
    ...base,
    suggestion: {
      kind: 'add-weight',
      weight,
      reps: target,
      why: `Every set hit ${target} reps at ${formatKg(lastTop.weight)} kg last time, so ${formatKg(weight)} kg is the next step.`,
    },
  };
}

/**
 * The most recent top set for every exercise the user has ever logged, keyed
 * by exercise id AND by lower-cased name (workouts from a buddy session carry
 * the host's ids). One pass over history so a list of 150 exercises can show
 * "last: 80 kg × 5" without 150 scans. Deload weeks are skipped for the same
 * reason as {@link collectExerciseSessions}.
 */
export function lastTopSetByExercise(workouts: readonly Workout[]): Map<string, LoggedSet> {
  const out = new Map<string, LoggedSet>();
  // Oldest first, so a later workout simply overwrites an earlier one.
  const ordered = [...workouts].sort((a, b) => newestFirst(b, a));
  for (const workout of ordered) {
    if (!workout.completed || workout.type === 'rest' || workout.deload) continue;
    for (const ex of workout.exercises) {
      const sets = ex.sets
        .filter((s) => s.completed && s.reps > 0)
        .map((s) => ({ weight: s.weight, reps: s.reps }));
      const best = topSet(sets);
      if (!best) continue;
      out.set(ex.exerciseId, best);
      out.set(ex.exerciseName.trim().toLowerCase(), best);
    }
  }
  return out;
}
