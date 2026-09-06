// Pure activity maths — docs/HEALTH_SPEC.md §4.
//
// Deliberately free of Capacitor, Firestore and localStorage so the merge
// rules and the weekly rollup can be unit-tested (tests/activity.test.ts).
// Never emit `undefined` values: ActivityDay goes straight into
// `setDoc`, and Firestore rejects undefined fields.

import type { ActivityDay, ActivitySession } from '../types';

/** `ActivitySession.source` for a session Health Connect gave us. */
export const HC_SOURCE = 'health-connect';
/** `ActivitySession.source` for a workout logged inside Zenith. */
export const APP_SOURCE = 'zenith';

/** The numeric metrics an `ActivityDay` carries, in tile order. */
export const ACTIVITY_METRICS = ['steps', 'activeKcal', 'totalKcal', 'restingHr', 'avgHr', 'sleepMin'] as const;
type Metric = (typeof ACTIVITY_METRICS)[number];

/** What one Health Connect sync read for a single local day. */
export type ActivityReadings = Partial<Record<Metric, number>> & { sessions?: ActivitySession[] };

/** True when the sync actually found something for this day. */
export function hasReadings(r: ActivityReadings): boolean {
  return ACTIVITY_METRICS.some((k) => r[k] !== undefined) || (r.sessions?.length ?? 0) > 0;
}

/**
 * Fold one day's Health Connect readings into the stored day.
 *
 * Health Connect wins for every metric it returned; anything the user
 * typed in by hand that this sync did not overwrite survives and marks
 * the day `mixed`. Returns null when there was nothing to merge, so the
 * caller can skip a pointless Firestore write.
 */
export function mergeActivityDay(existing: ActivityDay, readings: ActivityReadings): ActivityDay | null {
  if (!hasReadings(readings)) return null;

  const ownSessions = (existing.sessions ?? []).filter((s) => s.source !== HC_SOURCE);
  const sessions = [...ownSessions, ...(readings.sessions ?? [])].sort((a, b) => a.startAt.localeCompare(b.startAt));

  const keptManual =
    ownSessions.length > 0 ||
    (existing.source !== HC_SOURCE && ACTIVITY_METRICS.some((k) => readings[k] === undefined && existing[k] !== undefined));

  const merged: ActivityDay = { ...existing, source: keptManual ? 'mixed' : 'health-connect' };
  for (const k of ACTIVITY_METRICS) {
    const value = readings[k];
    if (value !== undefined) merged[k] = value;
  }
  if (sessions.length) merged.sessions = sessions;
  return merged;
}

/**
 * True when two days carry the same data (`updatedAt` ignored). Health
 * Connect returns the same numbers every 15 minutes; without this every
 * sync would burn a Firestore write per day (docs/COST_CONTROLS.md).
 */
export function sameActivityDay(a: ActivityDay, b: ActivityDay): boolean {
  if (a.source !== b.source) return false;
  if (ACTIVITY_METRICS.some((k) => a[k] !== b[k])) return false;
  return JSON.stringify(a.sessions ?? []) === JSON.stringify(b.sessions ?? []);
}

/** Add (or replace, by id) one session on a day. Marks a synced day `mixed`. */
export function addSessionToDay(existing: ActivityDay, session: ActivitySession): ActivityDay {
  const sessions = [...(existing.sessions ?? []).filter((s) => s.id !== session.id), session]
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const source = existing.source === 'health-connect' && session.source !== HC_SOURCE ? 'mixed' : existing.source;
  return { ...existing, sessions, source };
}

export interface WeeklyActivitySummary {
  /** Averaged over the days that actually carry the metric; null when none do. */
  avgSteps: number | null;
  avgActiveKcal: number | null;
  avgSleepMin: number | null;
  avgRestingHr: number | null;
  /** Days in the window with at least one metric or session. */
  daysWithData: number;
  /** Total number of sessions across the window. */
  sessions: number;
}

function average(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

export function summariseActivity(days: ActivityDay[]): WeeklyActivitySummary {
  const present = (k: Metric) => days.map((d) => d[k]).filter((v): v is number => v !== undefined);
  return {
    avgSteps: average(present('steps')),
    avgActiveKcal: average(present('activeKcal')),
    avgSleepMin: average(present('sleepMin')),
    avgRestingHr: average(present('restingHr')),
    daysWithData: days.filter((d) => hasReadings(d)).length,
    sessions: days.reduce((n, d) => n + (d.sessions?.length ?? 0), 0),
  };
}

/**
 * MET estimate for a lifting session: ~5 METs for resistance training,
 * kcal = MET × kg × hours. Returns undefined without a body weight —
 * we would rather show nothing than a made-up number.
 */
export function estimateWorkoutKcal(durationMin: number, bodyWeightKg?: number): number | undefined {
  if (!bodyWeightKg || durationMin <= 0) return undefined;
  return Math.round(5 * bodyWeightKg * (durationMin / 60));
}

/** "7h 12m" / "42m" for sleep minutes. */
export function formatSleep(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
