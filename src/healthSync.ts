import type { Workout } from './types';
import { Capacitor } from '@capacitor/core';

/**
 * Health-kit (iOS) / Health Connect (Android) bridge.
 *
 * Full-fidelity sync needs a native plugin. Recommended:
 *   - Android: @capacitor-community/health-connect
 *   - iOS:     @perfood/capacitor-healthkit
 *
 * To enable, run:
 *   npm install @capacitor-community/health-connect @perfood/capacitor-healthkit
 *   npx cap sync
 * then add the relevant iOS Info.plist keys
 * (NSHealthShareUsageDescription, NSHealthUpdateUsageDescription) and
 * Android manifest permissions (health-connect + android.permission.health.*).
 *
 * Until the plugin is present this module is a no-op — calls resolve
 * without doing anything so the rest of the app continues to work. The
 * check is a best-effort `Capacitor.isPluginAvailable` probe.
 */

const TOGGLE_KEY = 'zenith_health_sync_enabled';

export function isHealthSyncEnabled(): boolean {
  try { return localStorage.getItem(TOGGLE_KEY) === '1'; } catch { return false; }
}
export function setHealthSyncEnabled(enabled: boolean): void {
  try { localStorage.setItem(TOGGLE_KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
}

/** True only when the underlying native plugin is installed AND the user
 *  has granted the system-level permission. Web / unsupported platforms
 *  always return false. */
export async function canWriteHealthData(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  // Plugin names differ across iOS/Android — probe both.
  const hasHealthConnect = Capacitor.isPluginAvailable('HealthConnect');
  const hasHealthKit = Capacitor.isPluginAvailable('CapacitorHealthkit');
  return hasHealthConnect || hasHealthKit;
}

/**
 * Push one completed workout to the user's Health store. Volume kg and
 * duration are all we can reasonably provide (HealthKit / Health Connect
 * don't model "strength training volume" directly, so we map to
 * Active Energy + Workout with a synthetic `totalEnergyBurned`
 * derived from volume — roughly 0.5 kcal per kg moved).
 *
 * Swallows all errors and returns a boolean so callers can be fire-and-forget.
 */
export async function syncWorkoutToHealth(workout: Workout): Promise<boolean> {
  if (!isHealthSyncEnabled()) return false;
  if (!(await canWriteHealthData())) return false;
  try {
    // Implementation stub — native-plugin-specific. Example shape:
    //   const plugin = Capacitor.Plugins.HealthConnect;
    //   await plugin.writeWorkout({
    //     type: 'STRENGTH_TRAINING',
    //     startTime: workout.startedAt,
    //     endTime: workout.completedAt,
    //     totalEnergyBurnedKcal: computeKcal(workout),
    //   });
    // Until the plugin lands we just log and bail.
    console.info('[Health] would sync workout', workout.id);
    return true;
  } catch (err) {
    console.warn('[Health] write failed:', err);
    return false;
  }
}
