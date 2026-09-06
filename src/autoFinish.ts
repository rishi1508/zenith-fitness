import type { Workout, SessionParticipant } from './types';

/**
 * Idle auto-finish for forgotten workouts.
 *
 * A workout left open with no interaction for AUTO_FINISH_IDLE_MS is
 * finished automatically, stamped with the time of the LAST interaction
 * (not the moment we noticed), so its duration reflects the real session.
 * "Interaction" = any set edit, or any tap/keypress anywhere in the app
 * while the workout is open (throttled to once a minute).
 *
 * There is no server-side timer (Firebase Spark, no background JS on
 * Android/PWA), so the check runs every minute while the app is open and
 * immediately when it comes back to the foreground. A workout forgotten
 * for two days is therefore closed retroactively on the next app open,
 * with the correct end time.
 *
 * In a group session the workout is only closed once EVERY active
 * participant has been idle past the threshold — one buddy still training
 * keeps the whole session open.
 */

export const AUTO_FINISH_IDLE_MS = 2 * 60 * 60 * 1000;
/** Minimum gap between two lastActivityAt stamps from generic taps. */
export const ACTIVITY_THROTTLE_MS = 60 * 1000;
/** How often the foreground checker runs. */
export const AUTO_FINISH_CHECK_MS = 60 * 1000;

/** Epoch ms of the last interaction with an in-progress workout. */
export function lastActivityMs(workout: Workout): number {
  const iso = workout.lastActivityAt ?? workout.startedAt ?? workout.date;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

export function isIdlePastThreshold(workout: Workout, now: number = Date.now()): boolean {
  const last = lastActivityMs(workout);
  if (!Number.isFinite(last)) return false;
  return now - last >= AUTO_FINISH_IDLE_MS;
}

/**
 * Has this participant done anything recently? Falls back to when they
 * joined / the session started for clients that never wrote lastActiveAt.
 */
export function participantIsActive(
  p: Pick<SessionParticipant, 'status' | 'lastActiveAt' | 'joinedAt'>,
  sessionStartedAt: string | undefined,
  now: number = Date.now(),
): boolean {
  if (p.status !== 'active' && p.status !== 'joined') return false;
  const iso = p.lastActiveAt ?? p.joinedAt ?? sessionStartedAt;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && now - t < AUTO_FINISH_IDLE_MS;
}

/**
 * The finished record for an idle workout, or null when nothing was
 * logged (the caller discards it instead of saving an empty workout).
 * Mirrors finishWorkout's cleanup: sets with reps are kept and marked
 * complete; empty sets and exercises are dropped.
 */
export function buildAutoFinishedWorkout(workout: Workout, endedAt: string): Workout | null {
  const exercises = workout.exercises
    .map((ex) => ({
      ...ex,
      sets: ex.sets.filter((s) => s.reps > 0).map((s) => ({ ...s, completed: true })),
    }))
    .filter((ex) => ex.sets.length > 0);
  if (exercises.length === 0) return null;

  const startedMs = workout.startedAt ? new Date(workout.startedAt).getTime() : NaN;
  const endedMs = new Date(endedAt).getTime();
  const duration = Number.isFinite(startedMs) && Number.isFinite(endedMs)
    ? Math.max(1, Math.round((endedMs - startedMs) / 60000))
    : undefined;

  return {
    ...workout,
    exercises,
    completed: true,
    completedAt: endedAt,
    duration,
    autoCompleted: true,
  };
}

/** "6 Sep, 9:42 pm" — for the auto-finish notice. */
export function formatEndedAt(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
