import type { ExerciseCategory } from './types';

/** 'full_body' → 'Full Body', 'compound' → 'Compound'. */
export function labelize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

/** Sensible default category from an exercise name — the user can still change it. */
export function guessCategory(name: string): ExerciseCategory {
  const n = name.toLowerCase();
  if (/treadmill|run|jog|cycl|bike|rowing machine|elliptical|stair|skipping|jump rope|swim|walk/.test(n)) return 'cardio';
  if (/crunch|plank|leg raise|sit-?up|\bab\b|abs\b|hollow|dead ?bug|toe touch|russian twist/.test(n)) return 'core';
  if (/press|squat|deadlift|\brow\b|rows\b|pull-?up|pulldown|lunge|thrust|clean|dip|push-?up|chin-?up|muscle-?up/.test(n)) return 'compound';
  return 'isolation';
}
