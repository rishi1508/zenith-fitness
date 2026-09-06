import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

/**
 * When the host ends a buddy session (status flips to 'completed'),
 * save EVERY participant's workout to their cloud history server-side.
 *
 * Why: the client-side flow only persists when the participant's app
 * is open / its session listener is active. Backgrounded or closed
 * apps would silently lose the workout on host-end. This trigger is
 * the belt-and-suspenders fix — workouts land in
 * users/{uid}/data/workouts even if the participant never reopens the
 * app.
 *
 * Idempotent: each participant's workouts array is checked for an
 * existing entry with the same sessionId before appending. The
 * participant's own client save (if it ran) wins by going first; this
 * trigger's transaction sees that entry and skips. If the trigger
 * goes first, the client's later save will see the duplicate and
 * skip. Either way, exactly one workout per session per participant.
 */
export const saveWorkoutOnSessionComplete = onDocumentUpdated(
  "workoutSessions/{sessionId}",
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Only fire on the transition INTO 'completed'. We don't auto-save
    // for 'cancelled' — host explicitly aborted, the client discards.
    if (before.status === after.status) return;
    if (after.status !== "completed") return;

    const sessionId = event.params.sessionId;
    const session = after as Record<string, unknown> & {
      participants?: Record<string, Record<string, unknown>>;
      hostUid?: string;
      workoutName?: string;
      workoutType?: string;
      startedAt?: string;
      completedAt?: string;
    };
    const participants = session.participants || {};

    for (const [uid, raw] of Object.entries(participants)) {
      const participant = raw as Record<string, unknown> & { status?: string; duration?: number };
      // Skip people who never actually joined the workout.
      if (participant?.status === "declined" || participant?.status === "invited") continue;

      try {
        const progressRef = db.doc(`workoutSessions/${sessionId}/progress/${uid}`);
        const progressSnap = await progressRef.get();
        if (!progressSnap.exists) continue;
        const progressData = progressSnap.data() as { exercises?: Array<Record<string, unknown>> } | undefined;
        const allExercises = progressData?.exercises || [];

        // Drop exercises with no logged sets — saving a fully-empty
        // workout would clutter history without conveying anything.
        const exercises = allExercises
          .map((ex) => {
            const sets = ((ex.sets as Array<Record<string, unknown>>) || []).filter((s) => {
              const completed = !!s.completed;
              const weight = Number(s.weight) || 0;
              const reps = Number(s.reps) || 0;
              return completed && weight > 0 && reps > 0;
            });
            return { ...ex, sets };
          })
          .filter((ex) => Array.isArray(ex.sets) && (ex.sets as unknown[]).length > 0);

        if (exercises.length === 0) {
          console.log(`[saveWorkoutOnSessionComplete] ${uid} has no logged sets, skipping`);
          continue;
        }

        const workoutsRef = db.doc(`users/${uid}/data/workouts`);
        await db.runTransaction(async (tx) => {
          const wSnap = await tx.get(workoutsRef);
          const existing = (wSnap.data()?.value || []) as Array<Record<string, unknown>>;
          if (existing.some((w) => w?.sessionId === sessionId)) {
            console.log(`[saveWorkoutOnSessionComplete] ${uid} already has session ${sessionId}, skipping`);
            return;
          }

          const completedAt = session.completedAt || new Date().toISOString();
          const startedAt = session.startedAt;
          const duration = participant.duration ?? (
            startedAt ? Math.max(0, Math.floor((Date.parse(completedAt) - Date.parse(startedAt)) / 60000)) : undefined
          );

          const workout: Record<string, unknown> = {
            id: `session_${sessionId}_${uid}`,
            date: completedAt,
            name: session.workoutName || "Buddy Session",
            type: session.workoutType || "custom",
            exercises,
            completed: true,
            completedAt,
            sessionId,
          };
          if (startedAt) workout.startedAt = startedAt;
          if (typeof duration === "number") workout.duration = duration;

          existing.unshift(workout);
          tx.set(
            workoutsRef,
            {value: existing, updatedAt: Date.now()},
            {merge: true},
          );
        });
        console.log(`[saveWorkoutOnSessionComplete] saved workout for ${uid} from session ${sessionId}`);
      } catch (err) {
        console.error(`[saveWorkoutOnSessionComplete] failed for ${uid}:`, err);
      }
    }
  },
);
