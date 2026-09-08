import type { Workout, WorkoutExercise, WorkoutSet, TemplateExercise } from './types';

/**
 * Pure diff-and-merge between the host's broadcast template and a
 * participant's current workout. Used by App.tsx (in the session
 * listener) to apply host modifications to non-host workouts without
 * trampling the participant's own state.
 *
 * Rules
 * -----
 *   ADDED  (in new template, not in prev):
 *     The host added an exercise. Append it to the participant's
 *     workout with `defaultSets` empty sets. Skip if the participant
 *     already has it (e.g. they added the same one locally).
 *
 *   REMOVED (in prev, not in new):
 *     The host removed an exercise. Drop it from the participant's
 *     workout — UNLESS they've already logged at least one set on it,
 *     in which case we keep it locally so they don't lose their
 *     completed work. (Non-destructive sync: host changes never erase
 *     participant data.)
 *
 *   SET COUNT CHANGED (in both, defaultSets differs):
 *     - Increased: append empty sets up to the new count.
 *     - Decreased: trim from the END, but preserve any logged set.
 *       (We split into filled vs unfilled, keep all filled, then keep
 *        only enough unfilled to hit the target.)
 *
 * Exercises the participant added themselves and that aren't in the
 * host's template — at all — are left alone.
 *
 * Returns null when the new template introduces no observable change
 * relative to prev (so the caller can skip a redundant React state
 * update).
 */
export function reconcileWorkoutWithTemplate(
  workout: Workout,
  newTemplate: TemplateExercise[],
  prevTemplate: TemplateExercise[],
): Workout | null {
  const newById = new Map(newTemplate.map((t) => [t.exerciseId, t]));
  const prevById = new Map(prevTemplate.map((t) => [t.exerciseId, t]));

  const added = newTemplate.filter((t) => !prevById.has(t.exerciseId));
  const removedIds = new Set(
    prevTemplate
      .filter((t) => !newById.has(t.exerciseId))
      .map((t) => t.exerciseId),
  );
  const setCountChanges = new Map<string, number>();
  for (const t of newTemplate) {
    const prev = prevById.get(t.exerciseId);
    if (prev && prev.defaultSets !== t.defaultSets) {
      setCountChanges.set(t.exerciseId, t.defaultSets);
    }
  }

  if (added.length === 0 && removedIds.size === 0 && setCountChanges.size === 0) {
    return null;
  }

  let exercises: WorkoutExercise[] = [...workout.exercises];
  let changed = false;

  // 1. REMOVE — only when no logged set exists for that exercise
  exercises = exercises.filter((ex) => {
    if (!removedIds.has(ex.exerciseId)) return true;
    if (hasLoggedSet(ex)) return true; // preserve user data
    changed = true;
    return false;
  });

  // 2. SET COUNT CHANGES
  exercises = exercises.map((ex) => {
    const target = setCountChanges.get(ex.exerciseId);
    if (target === undefined || target === ex.sets.length) return ex;

    if (target > ex.sets.length) {
      const additional: WorkoutSet[] = Array.from(
        { length: target - ex.sets.length },
        () => emptySet(),
      );
      changed = true;
      return { ...ex, sets: [...ex.sets, ...additional] };
    }

    // target < current — trim from the END, preserving any logged sets.
    const filled = ex.sets.filter(isLogged);
    const unfilled = ex.sets.filter((s) => !isLogged(s));
    const extras = Math.max(0, target - filled.length);
    const next = [...filled, ...unfilled.slice(0, extras)];
    if (next.length === ex.sets.length) return ex;
    changed = true;
    return { ...ex, sets: next };
  });

  // 3. ADD — append exercises the host introduced that the participant
  //    doesn't already have.
  for (const tpl of added) {
    if (exercises.some((ex) => ex.exerciseId === tpl.exerciseId)) continue;
    const newSets: WorkoutSet[] = Array.from(
      { length: Math.max(1, tpl.defaultSets) },
      () => ({
        id: cryptoUUID(),
        weight: 0,
        reps: tpl.defaultReps || 0,
        completed: false,
      }),
    );
    exercises.push({
      id: cryptoUUID(),
      exerciseId: tpl.exerciseId,
      exerciseName: tpl.exerciseName,
      sets: newSets,
      ...(tpl.supersetGroup ? { supersetGroup: tpl.supersetGroup } : {}),
    });
    changed = true;
  }

  return changed ? { ...workout, exercises } : null;
}

/** Build the broadcast template from the host's current workout. */
export function templateFromWorkout(workout: Workout): TemplateExercise[] {
  return workout.exercises.map((ex) => ({
    exerciseId: ex.exerciseId,
    exerciseName: ex.exerciseName,
    defaultSets: ex.sets.length || 1,
    // First non-zero reps in the working set, falling back to 0. The
    // participant's reconcile uses this only for newly-appended sets,
    // so the exact value matters less than "something sensible".
    defaultReps: ex.sets.find((s) => s.reps > 0)?.reps || 0,
    ...(ex.supersetGroup ? { supersetGroup: ex.supersetGroup } : {}),
  }));
}

/** Two TemplateExercise[] are equal for sync purposes if every entry matches
 *  by id, name, defaultSets and supersetGroup.
 *
 *  `defaultReps` is deliberately NOT compared. The host's live template is
 *  derived from their in-progress workout, where reps start at 0 and change
 *  as they log — so including it made every snapshot look like a structural
 *  change and ran the reconcile (which can delete a participant's unlogged
 *  exercises) many times per session for no reason. */
export function templatesEqual(
  a: TemplateExercise[] | undefined,
  b: TemplateExercise[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]; const y = b[i];
    if (x.exerciseId !== y.exerciseId) return false;
    if (x.exerciseName !== y.exerciseName) return false;
    if (x.defaultSets !== y.defaultSets) return false;
    if ((x.supersetGroup || null) !== (y.supersetGroup || null)) return false;
  }
  return true;
}

// ----- helpers -----

function isLogged(s: WorkoutSet): boolean {
  return !!s.completed || (s.weight > 0 && s.reps > 0);
}

function hasLoggedSet(ex: WorkoutExercise): boolean {
  return ex.sets.some(isLogged);
}

function emptySet(): WorkoutSet {
  return { id: cryptoUUID(), weight: 0, reps: 0, completed: false };
}

function cryptoUUID(): string {
  // crypto.randomUUID is in WebCrypto; safe in Capacitor WebView.
  // Fall back to a timestamp-ish id if unavailable (tests).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
