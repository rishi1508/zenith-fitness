import type { Workout } from './types';
import { isAvailable, writeWorkout } from './activity/healthConnect';

/**
 * Health Connect bridge for finished workouts — the Settings "Health sync"
 * toggle owns the consent, `src/activity/healthConnect.ts` owns the plugin.
 *
 * Health Connect itself will not take an exercise session from us: no
 * Capacitor plugin that builds against AGP 8 exposes an
 * ExerciseSessionRecord write. `writeWorkout` therefore records the
 * session on the day's own `ActivityDay` (source `zenith`) so it shows up
 * in the Activity view and survives later Health Connect syncs. Body
 * weight is the one value we can push into Health Connect
 * (`activity.writeWeight`).
 */

const TOGGLE_KEY = 'zenith_health_sync_enabled';

export function isHealthSyncEnabled(): boolean {
  try { return localStorage.getItem(TOGGLE_KEY) === '1'; } catch { return false; }
}
export function setHealthSyncEnabled(enabled: boolean): void {
  try { localStorage.setItem(TOGGLE_KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
}

/** True only on a native Android build with Health Connect installed. */
export function canWriteHealthData(): Promise<boolean> {
  return isAvailable();
}

/** Fire-and-forget from App.tsx when a workout finishes. Never throws. */
export async function syncWorkoutToHealth(workout: Workout): Promise<boolean> {
  if (!isHealthSyncEnabled()) return false;
  if (!(await canWriteHealthData())) return false;
  try {
    return await writeWorkout(workout);
  } catch (err) {
    console.warn('[Health] write failed:', err);
    return false;
  }
}
