import type { Exercise, ExerciseCategory } from './types';

/** Default rest seconds per category. Can be customized per-user later. */
const DEFAULTS: Record<ExerciseCategory, number> = {
  compound: 180,
  isolation: 75,
  cardio: 30,
  core: 45,
  other: 90,
};

/**
 * Derive the rest-timer default for an exercise. Uses the explicit
 * category if set, else falls back to the legacy isCompound boolean, else
 * 90 s.
 */
export function defaultRestSecondsFor(exercise: Exercise | undefined | null): number {
  if (!exercise) return 90;
  if (exercise.category) return DEFAULTS[exercise.category];
  return exercise.isCompound ? DEFAULTS.compound : DEFAULTS.isolation;
}
