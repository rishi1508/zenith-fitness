import type { Exercise } from '../../types';
import type { ExerciseFormValues } from '../../components/ExerciseForm';
import * as sessionService from '../../workoutSessionService';
import { createAndPublishExercise } from '../../sharedExercises';

/**
 * Shared by every picker: create the exercise locally + in the shared
 * library, and broadcast it to the group session (if any) so buddies get
 * the SAME id instead of re-creating it with a different one.
 */
export function createExerciseFromForm(values: ExerciseFormValues, sessionId?: string): Exercise {
  const created = createAndPublishExercise({
    name: values.name,
    muscleGroup: values.muscleGroup,
    category: values.category,
    equipment: values.equipment,
    sharedNotes: values.sharedNotes || undefined,
    notes: values.notes || undefined,
    videoUrl: values.videoUrl || undefined,
  });
  if (sessionId) {
    sessionService
      .addCustomExerciseToSession(sessionId, created)
      .catch((err) => console.warn('[Session] broadcast new exercise failed', err));
  }
  return created;
}
