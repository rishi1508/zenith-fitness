// Health Connect bridge — docs/HEALTH_SPEC.md §4.
//
// Plugin: @capgo/capacitor-health (Capacitor 8, Health Connect on Android
// 8+/API 26). It reads everything we need and writes body weight, but it
// exposes NO API for writing an ExerciseSessionRecord — `saveSample` only
// accepts the scalar record types, and `workouts` is documented read-only.
// The one Capacitor plugin that does write sessions
// (@flomentumsolutions/capacitor-health-extended) still ships a `package=`
// attribute in its library manifest, which AGP 8 rejects outright, so it
// cannot be built into this app. `writeWorkout` therefore records the
// finished session on our own ActivityDay instead of in Health Connect —
// see its doc comment.

import { Capacitor } from '@capacitor/core';
import { Health, type AggregationType, type HealthDataType } from '@capgo/capacitor-health';
import type { ActivitySession, Workout } from '../types';
import { addDaysISO, getActivityDay, localDateISO, saveActivityDay } from '../health/store';
import * as storage from '../storage';
import {
  ACTIVITY_METRICS, APP_SOURCE, HC_SOURCE, addSessionToDay, estimateWorkoutKcal, mergeActivityDay, sameActivityDay,
  type ActivityReadings,
} from './aggregate';

/** Exactly the scopes declared in android/app/src/main/AndroidManifest.xml. */
const READ_TYPES: HealthDataType[] = ['steps', 'calories', 'totalCalories', 'heartRate', 'restingHeartRate', 'sleep', 'workouts', 'weight'];
const WRITE_TYPES: HealthDataType[] = ['weight'];

const LAST_SYNC_KEY = 'zenith_activity_last_sync';
const WRITTEN_IDS_KEY = 'zenith_health_written_ids';
const WRITTEN_IDS_MAX = 200;
/** Health Connect only serves ~30 days without READ_HEALTH_DATA_HISTORY. */
const MAX_SAMPLES = 2000;

export type PermissionState = 'unavailable' | 'granted' | 'partial' | 'denied';

/** Native Android + the plugin present + Health Connect installed. False on web/PWA. */
export async function isAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  if (!Capacitor.isPluginAvailable('Health')) return false;
  try {
    return (await Health.isAvailable()).available;
  } catch (e) {
    console.warn('[Activity] availability check failed', e);
    return false;
  }
}

/** Current grant state, without prompting. */
export async function getPermissionState(): Promise<PermissionState> {
  if (!(await isAvailable())) return 'unavailable';
  try {
    const status = await Health.checkAuthorization({ read: READ_TYPES, write: WRITE_TYPES });
    if (!status.readAuthorized.length) return 'denied';
    return status.readDenied.length ? 'partial' : 'granted';
  } catch (e) {
    console.warn('[Activity] permission check failed', e);
    return 'denied';
  }
}

/** Opens the Health Connect permission sheet and returns the resulting state. */
export async function requestPermissions(): Promise<PermissionState> {
  if (!(await isAvailable())) return 'unavailable';
  try {
    const status = await Health.requestAuthorization({ read: READ_TYPES, write: WRITE_TYPES });
    if (!status.readAuthorized.length) return 'denied';
    return status.readDenied.length ? 'partial' : 'granted';
  } catch (e) {
    console.warn('[Activity] permission request failed', e);
    return 'denied';
  }
}

/** Health Connect's own settings screen (to grant or revoke by hand). */
export async function openSettings(): Promise<void> {
  if (!(await isAvailable())) return;
  try {
    await Health.openHealthConnectSettings();
  } catch (e) {
    console.warn('[Activity] could not open Health Connect settings', e);
  }
}

export function lastSyncedAt(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}

function markSynced(): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  } catch { /* private mode */ }
}

/** Local midnight of `dateISO` as an instant. */
function dayStart(dateISO: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(y, m - 1, d);
}

type DayValues = Map<string, number>;

/** One bucket per local day; Health Connect aggregates server-side. */
async function aggregateByDay(dataType: HealthDataType, aggregation: AggregationType, startDate: string, endDate: string): Promise<DayValues> {
  const out: DayValues = new Map();
  try {
    const { samples } = await Health.queryAggregated({ dataType, startDate, endDate, bucket: 'day', aggregation });
    for (const s of samples) out.set(localDateISO(new Date(s.startDate)), Math.round(s.value));
  } catch (e) {
    console.warn('[Activity] aggregate failed', dataType, e);
  }
  return out;
}

/** For types Health Connect refuses to aggregate (totalCalories): sum the raw samples. */
async function sumSamplesByDay(dataType: HealthDataType, startDate: string, endDate: string): Promise<DayValues> {
  const out: DayValues = new Map();
  try {
    const { samples } = await Health.readSamples({ dataType, startDate, endDate, limit: MAX_SAMPLES });
    for (const s of samples) {
      const date = localDateISO(new Date(s.startDate));
      out.set(date, (out.get(date) ?? 0) + s.value);
    }
  } catch (e) {
    console.warn('[Activity] sample read failed', dataType, e);
  }
  for (const [date, value] of out) out.set(date, Math.round(value));
  return out;
}

/**
 * Sleep is credited to the day you wake up on, so the query reaches back
 * one extra day to catch the night that ends on `from`.
 */
async function sleepByDay(from: string, endDate: string): Promise<DayValues> {
  const out: DayValues = new Map();
  try {
    const { samples } = await Health.readSamples({
      dataType: 'sleep',
      startDate: dayStart(addDaysISO(from, -1)).toISOString(),
      endDate,
      limit: MAX_SAMPLES,
    });
    for (const s of samples) {
      const date = localDateISO(new Date(s.endDate));
      out.set(date, (out.get(date) ?? 0) + s.value);
    }
  } catch (e) {
    console.warn('[Activity] sleep read failed', e);
  }
  for (const [date, value] of out) out.set(date, Math.round(value));
  return out;
}

async function sessionsByDay(startDate: string, endDate: string): Promise<Map<string, ActivitySession[]>> {
  const out = new Map<string, ActivitySession[]>();
  try {
    const { workouts } = await Health.queryWorkouts({ startDate, endDate, limit: 200, ascending: true });
    for (const w of workouts) {
      const date = localDateISO(new Date(w.startDate));
      const session: ActivitySession = {
        id: w.platformId ?? `${w.startDate}-${w.workoutType}`,
        type: w.workoutType,
        startAt: w.startDate,
        durationMin: Math.round(w.duration / 60),
        source: HC_SOURCE,
      };
      if (w.totalEnergyBurned !== undefined) session.kcal = Math.round(w.totalEnergyBurned);
      out.set(date, [...(out.get(date) ?? []), session]);
    }
  } catch (e) {
    console.warn('[Activity] workout read failed', e);
  }
  return out;
}

/**
 * Read [from, to] (inclusive, local dates) out of Health Connect and merge
 * each day into its stored `ActivityDay`. Returns how many days changed.
 * A denied scope only loses its own metric — the rest of the sync still runs.
 */
export async function syncDays(from: string, to: string): Promise<number> {
  if (!(await isAvailable())) return 0;
  const startDate = dayStart(from).toISOString();
  const endDate = dayStart(addDaysISO(to, 1)).toISOString();

  const [steps, activeKcal, restingHr, avgHr, totalKcal, sleepMin, sessions] = await Promise.all([
    aggregateByDay('steps', 'sum', startDate, endDate),
    aggregateByDay('calories', 'sum', startDate, endDate),
    aggregateByDay('restingHeartRate', 'average', startDate, endDate),
    aggregateByDay('heartRate', 'average', startDate, endDate),
    sumSamplesByDay('totalCalories', startDate, endDate),
    sleepByDay(from, endDate),
    sessionsByDay(startDate, endDate),
  ]);

  const byMetric = { steps, activeKcal, totalKcal, restingHr, avgHr, sleepMin };

  let changed = 0;
  for (let date = from; date <= to; date = addDaysISO(date, 1)) {
    const readings: ActivityReadings = { sessions: sessions.get(date) };
    for (const metric of ACTIVITY_METRICS) {
      const value = byMetric[metric].get(date);
      if (value !== undefined) readings[metric] = value;
    }

    const existing = getActivityDay(date);
    const merged = mergeActivityDay(existing, readings);
    if (merged && !sameActivityDay(merged, existing)) {
      saveActivityDay(merged);
      changed++;
    }
  }
  markSynced();
  return changed;
}

/** Sync the trailing `days` (today included). Used by the view and the 15-minute gate. */
export function syncRecentDays(days = 7): Promise<number> {
  const to = localDateISO();
  return syncDays(addDaysISO(to, -(days - 1)), to);
}

function writtenWorkoutIds(): string[] {
  try {
    const raw = localStorage.getItem(WRITTEN_IDS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function markWorkoutWritten(id: string): void {
  try {
    localStorage.setItem(WRITTEN_IDS_KEY, JSON.stringify([id, ...writtenWorkoutIds().filter((x) => x !== id)].slice(0, WRITTEN_IDS_MAX)));
  } catch { /* private mode */ }
}

/**
 * Record a finished Zenith workout as an activity session.
 *
 * Health Connect itself cannot take it: no Capacitor plugin that builds
 * against AGP 8 exposes an ExerciseSessionRecord write (see the file
 * header), so the session lands on our own `ActivityDay` with
 * `source: 'zenith'` instead. `mergeActivityDay` keeps sessions that
 * aren't Health Connect's, so a later sync will not wipe it.
 *
 * Idempotent per workout id via `zenith_health_written_ids`.
 */
export async function writeWorkout(workout: Workout): Promise<boolean> {
  if (writtenWorkoutIds().includes(workout.id)) return true;

  const startAt = workout.startedAt ?? workout.completedAt ?? workout.date;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return false;

  const end = workout.completedAt ? new Date(workout.completedAt) : null;
  const durationMin = workout.duration ?? (end ? Math.round((end.getTime() - start.getTime()) / 60_000) : 0);
  if (durationMin <= 0) return false;

  const session: ActivitySession = {
    id: workout.id,
    type: 'strengthTraining',
    startAt: start.toISOString(),
    durationMin,
    source: APP_SOURCE,
  };
  const kcal = estimateWorkoutKcal(durationMin, storage.getLatestBodyWeight()?.weight);
  if (kcal !== undefined) session.kcal = kcal;

  const date = localDateISO(start);
  saveActivityDay(addSessionToDay(getActivityDay(date), session));
  markWorkoutWritten(workout.id);
  return true;
}

/** Body weight → Health Connect (the one write the plugin supports). */
export async function writeWeight(kg: number, dateISO?: string): Promise<boolean> {
  if (!(await isAvailable())) return false;
  try {
    await Health.saveSample({
      dataType: 'weight',
      value: kg,
      startDate: (dateISO ? dayStart(dateISO) : new Date()).toISOString(),
    });
    return true;
  } catch (e) {
    console.warn('[Activity] weight write failed', e);
    return false;
  }
}
