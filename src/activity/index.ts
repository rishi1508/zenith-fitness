// Activity package barrel — docs/HEALTH_SPEC.md §4.
import { addDaysISO, listActivityDays, localDateISO } from '../health/store';
import { summariseActivity, type WeeklyActivitySummary } from './aggregate';

export {
  isAvailable, getPermissionState, requestPermissions, openSettings,
  syncDays, syncRecentDays, writeWorkout, writeWeight, lastSyncedAt,
} from './healthConnect';
export type { PermissionState } from './healthConnect';

export { startActivityAutoSync, syncIfStale } from './autoSync';

export {
  ACTIVITY_METRICS, APP_SOURCE, HC_SOURCE,
  addSessionToDay, estimateWorkoutKcal, formatSleep, hasReadings, mergeActivityDay, sameActivityDay, summariseActivity,
} from './aggregate';
export type { ActivityReadings, WeeklyActivitySummary } from './aggregate';

/**
 * Trailing-window rollup for the phase engine (H2) and Zen. Reads the
 * local cache only — no Firestore reads, so it is safe to call on render.
 */
export function getWeeklyActivitySummary(days = 7): WeeklyActivitySummary {
  const to = localDateISO();
  return summariseActivity(listActivityDays(addDaysISO(to, -(days - 1)), to));
}
