import * as storage from '../storage';
import { buildExtendedContext, suggestNextWorkout } from '../coachService';
import type { ExtendedCoachContext } from '../coachService';
import { localIso, weekStartISO, addDays, workoutDaySet } from '../streakService';
import { membershipStatus, upcomingSessions } from '../gymStats';
import { addDaysISO, getNutritionDay, getPhaseSettings, getTargets, listActivityDays, listNutritionDays, localDateISO } from '../health/store';
import type { Gym, GymMember, GymClass, MembershipStatus, Workout, BodyMeasurementEntry } from '../types';
import { fmtDay, fmtDate, fmtShort, fmtVolume, fmtExerciseBest, workoutVolume, capChars, signed, num } from './format';
import { activityContextLine, energyContextLine, nutritionContextLines, phaseContextLine, weightTrend } from './healthLines';
import { energyForDay } from '../health/energyDay';

/**
 * `buildZenContext()` — everything Zen needs to know about this user,
 * packaged as one compact string (see docs/REVAMP_SPEC.md §6). Built
 * entirely from `storage.ts` + `coachService.ts` + `streakService.ts` +
 * `gymStats.ts` + the *cached* reads of `health/store.ts`, none of which
 * touch the network, so this module has no network or auth dependency of
 * its own.
 *
 * Gym data is the one exception: it lives in Firestore via `useGym()`,
 * not localStorage, so the caller (a component that already holds that
 * hook's result) passes it in rather than this module fetching it.
 *
 * Target size: comfortably under the server's 10,000-char cap
 * (api/_zenProtocol.ts MAX_CONTEXT_CHARS) — `capChars` below is a
 * belt-and-braces backstop, not the primary control.
 */

const MAX_CONTEXT_CHARS = 10_000;
const DAY_LETTERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_LABEL: Record<MembershipStatus, string> = {
  active: 'active member',
  expiring: 'expiring soon',
  expired: 'expired',
  frozen: 'frozen',
  none: 'no active plan',
};

/** The subset of `useGym()` that's relevant to Zen. */
export interface ZenGymInput {
  gym: Gym | null;
  membership: GymMember | null;
  classes?: GymClass[];
}

export interface BuildZenContextOptions {
  /** Signed-in user's display name (from Firebase auth), if any. */
  userName?: string | null;
  gym?: ZenGymInput | null;
  now?: Date;
}

export function buildZenContext(opts: BuildZenContextOptions = {}): string {
  const now = opts.now ?? new Date();
  const ctx = buildExtendedContext();
  const workouts = storage.getWorkouts();
  const stats = storage.calculateStats();

  const lines: string[] = [];

  const firstName = opts.userName?.trim().split(/\s+/)[0];
  const commitment = storage.getStreakCommitment();
  lines.push(
    `${firstName ? `Name: ${firstName}. ` : ''}Commitment: ${commitment} day${commitment === 1 ? '' : 's'}/week. Units: kg.`,
  );

  if (stats.totalWorkouts > 0) {
    lines.push(
      `Stats: ${stats.totalWorkouts} workouts logged, ${fmtVolume(stats.totalVolume)} kg total volume, ${fmtVolume(stats.avgVolumePerSession)} kg avg/session.`,
    );
  }

  const { level, currentWeeks, longestWeeks, freezesAvailable, workoutsToNextFreeze } = ctx.streak;
  lines.push(
    `Streak: ${currentWeeks} week${currentWeeks === 1 ? '' : 's'} at ${level}★ (longest ${longestWeeks}). Freezes: ${freezesAvailable}/2 (${workoutsToNextFreeze} workouts to next).`,
  );

  lines.push(`This week: ${formatThisWeek(workouts, now)}.`);

  const planLine = formatActivePlan(ctx);
  if (planLine) lines.push(planLine);

  const recent = ctx.recentWorkouts.slice(0, 7);
  if (recent.length > 0) {
    lines.push('Last workouts:');
    for (const w of recent) lines.push(`- ${formatWorkoutLine(w)}`);
  }

  if (ctx.personalRecords.length > 0) {
    const top = ctx.personalRecords
      .slice(0, 8)
      .map((pr) => `${pr.exerciseName} ${num(pr.weight, 2)}×${pr.reps} (${fmtShort(pr.date)})`)
      .join('; ');
    lines.push(`Top PRs: ${top}.`);
  }

  if (ctx.bodyWeight.current !== null) {
    const delta = ctx.bodyWeight.delta30d;
    const deltaStr = delta !== null ? `, 30d: ${signed(delta)}kg` : '';
    lines.push(`Body weight: ${num(ctx.bodyWeight.current, 1)}kg (${ctx.bodyWeight.samples} samples${deltaStr}).`);
  }

  if (ctx.latestMeasurement) {
    const m = formatMeasurements(ctx.latestMeasurement);
    if (m) lines.push(`Measurements (${fmtDate(ctx.latestMeasurement.date)}): ${m}.`);
  }

  // Nutrition / activity / phase (docs/HEALTH_SPEC.md §6). All cache
  // reads — no Firestore round trip on the way into a chat turn.
  const today = localDateISO(now);
  const weekStart = addDaysISO(today, -6);
  lines.push(...nutritionContextLines({
    today: getNutritionDay(today),
    week: listNutritionDays(weekStart, today),
    targets: getTargets(),
  }));
  const activityLine = activityContextLine(listActivityDays(weekStart, today));
  if (activityLine) lines.push(activityLine);
  const phaseLine = phaseContextLine(getPhaseSettings(), weightTrend(storage.getBodyWeightEntries(), now));
  if (phaseLine) lines.push(phaseLine);
  const energyLine = energyContextLine(energyForDay(today, now));
  if (energyLine) lines.push(energyLine);

  const gymLine = formatGymBlock(opts.gym, now);
  if (gymLine) lines.push(gymLine);

  return capChars(lines.join('\n'), MAX_CONTEXT_CHARS);
}

// ----- section formatters ---------------------------------------------

function formatThisWeek(workouts: Workout[], now: Date): string {
  const today = localIso(now);
  const trainedDays = workoutDaySet(workouts);
  const restDays = new Set<string>();
  for (const w of workouts) {
    if (!w.completed || w.type !== 'rest') continue;
    const d = new Date(w.date);
    if (!Number.isNaN(d.getTime())) restDays.add(localIso(d));
  }

  const ws = weekStartISO(now);
  const parts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const ds = addDays(ws, i);
    const label = DAY_LETTERS[i];
    if (trainedDays.has(ds)) parts.push(`${label} ✓`);
    else if (ds === today) parts.push(`${label} (today)`);
    else if (restDays.has(ds)) parts.push(`${label} rest`);
    else if (ds > today) parts.push(`${label} —`);
    else parts.push(`${label} ✗`);
  }
  return parts.join(', ');
}

function formatActivePlan(ctx: ExtendedCoachContext): string | null {
  if (!ctx.activePlan) return null;
  const [next] = suggestNextWorkout({
    workouts: [],
    exercises: [],
    bodyWeights: [],
    activePlan: ctx.activePlan,
    lastUsedDay: storage.getLastUsedDay(),
  });
  const nextLine = next ? ` Next up: ${next.body}` : '';
  return `Active plan: ${ctx.activePlan.name}.${nextLine}`;
}

function formatWorkoutLine(w: Workout): string {
  const parts: string[] = [];
  for (const ex of w.exercises) {
    if (parts.length >= 3) { parts.push('…'); break; }
    parts.push(fmtExerciseBest(ex.exerciseName, ex.sets));
  }
  const dur = w.duration ? ` · ${w.duration}min` : '';
  return `${fmtDay(w.date)} · ${w.name}${dur} · ${fmtVolume(workoutVolume(w))} kg · ${parts.join(', ') || 'no sets'}`;
}

function formatMeasurements(m: BodyMeasurementEntry): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(m.measurements)) {
    if (typeof v === 'number') parts.push(`${k} ${v}cm`);
  }
  return parts.join(', ');
}

function fmtClassTime(dateISO: string, hhmm: string): string {
  const d = new Date(dateISO + 'T00:00:00');
  const weekday = DAY_LETTERS[d.getDay()];
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10);
  if (!Number.isFinite(h)) return `${weekday} ${hhmm}`;
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${weekday} ${h}${mStr && mStr !== '00' ? ':' + mStr : ''}${ampm}`;
}

function formatGymBlock(input: ZenGymInput | null | undefined, now: Date): string | null {
  if (!input?.gym) return null;
  const { gym, membership, classes } = input;
  const bits: string[] = [gym.name];
  if (membership) {
    const status = membershipStatus(membership, now);
    bits.push(STATUS_LABEL[status]);
    if (membership.planEnd && (status === 'active' || status === 'expiring')) {
      const daysLeft = Math.round((new Date(membership.planEnd + 'T00:00:00').getTime() - new Date(localIso(now) + 'T00:00:00').getTime()) / 86_400_000);
      bits.push(`${daysLeft}d left`);
    }
    if (membership.checkinCount30d !== undefined) bits.push(`${membership.checkinCount30d} visits/30d`);
  }
  let line = `Gym: ${bits.join(', ')}.`;
  if (classes && classes.length > 0) {
    const [next] = upcomingSessions(classes, now, 7);
    if (next) line += ` Next class: ${next.cls.name}, ${fmtClassTime(next.date, next.cls.startTime)}.`;
  }
  return line;
}
