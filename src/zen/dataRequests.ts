import * as storage from '../storage';
import type { Exercise } from '../types';
import { membershipStatus, upcomingSessions } from '../gymStats';
import { addDaysISO, getPhaseSettings, getTargets, listActivityDays, listNutritionDays, localDateISO } from '../health/store';
import type { ZenGymInput } from './contextPack';
import {
  fmtDay, fmtDate, fmtVolume, fmtSets, workoutVolume, capChars, num, localDay,
  isTraining, byDateAsc, byDateDesc,
} from './format';
import { formatActivityRange, formatNutritionRange, formatPhaseDetail } from './healthLines';

/**
 * Resolves one `zen_request` (the server's one-round data protocol, see
 * api/_zenPersona.ts) into the compact text Zen asked for. Everything
 * here reads from `storage.ts` and the cached day maps of
 * `health/store.ts` except `gym_summary`, which needs the gym data the
 * caller already holds via `useGym()` — see `contextPack.ts`'s
 * `ZenGymInput` for why this module doesn't reach into Firestore
 * itself.
 */

export type ZenRequestKind =
  | 'exercise_history'
  | 'workouts_range'
  | 'body_weight'
  | 'streak_detail'
  | 'plan_detail'
  | 'gym_summary'
  | 'prs'
  | 'volume_by_muscle'
  | 'nutrition_range'
  | 'activity_range'
  | 'phase_detail';

export interface ZenRequest {
  kind: ZenRequestKind;
  exercise?: string;
  sessions?: number;
  from?: string;
  to?: string;
  days?: number;
  weeks?: number;
}

const MAX_DATA_CHARS = 6_000;

export interface ResolveZenDataOptions {
  gym?: ZenGymInput;
}

export function resolveZenDataRequest(request: ZenRequest, opts: ResolveZenDataOptions = {}): string {
  return capChars(resolve(request, opts), MAX_DATA_CHARS);
}

function resolve(request: ZenRequest, opts: ResolveZenDataOptions): string {
  switch (request.kind) {
    case 'exercise_history': return exerciseHistory(request.exercise ?? '', request.sessions ?? 8);
    case 'workouts_range': return workoutsRange(request.from ?? '', request.to ?? '');
    case 'body_weight': return bodyWeight(request.days ?? 90);
    case 'streak_detail': return streakDetail();
    case 'plan_detail': return planDetail();
    case 'gym_summary': return gymSummary(opts.gym);
    case 'prs': return prs();
    case 'volume_by_muscle': return volumeByMuscle(request.weeks ?? 4);
    case 'nutrition_range': return nutritionRange(request.from ?? '', request.to ?? '');
    case 'activity_range': return activityRange(request.from ?? '', request.to ?? '');
    case 'phase_detail': return phaseDetail();
    default: return 'Unknown request.';
  }
}

// ----- individual resolvers --------------------------------------------

/** Exact name match first (case/whitespace-insensitive, same as the
 *  rest of the app); falls back to a substring match either way so a
 *  slightly-off name from the model ("bench" for "Bench Press") still
 *  resolves instead of dead-ending the conversation. */
function resolveExercise(query: string, exercises: Exercise[]): Exercise | undefined {
  const exact = storage.findExerciseByName(query, exercises);
  if (exact) return exact;
  const key = storage.exerciseNameKey(query);
  if (!key) return undefined;
  return (
    exercises.find((e) => storage.exerciseNameKey(e.name).includes(key)) ??
    exercises.find((e) => key.includes(storage.exerciseNameKey(e.name)))
  );
}

function exerciseHistory(exerciseName: string, sessions: number): string {
  const exercises = storage.getExercises();
  const match = resolveExercise(exerciseName, exercises);
  if (!match) return `No exercise named "${exerciseName}" in the library.`;
  const rows = storage
    .getWorkouts()
    .filter(isTraining)
    .filter((w) => w.exercises.some((e) => e.exerciseId === match.id))
    .sort(byDateDesc)
    .slice(0, sessions);
  if (rows.length === 0) return `No logged sessions for ${match.name}.`;
  const lines = rows.map((w) => {
    const ex = w.exercises.find((e) => e.exerciseId === match.id)!;
    return `${fmtDay(w.date)}: ${fmtSets(ex.sets)}`;
  });
  return `${match.name} — last ${lines.length} session${lines.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
}

function workoutsRange(from: string, to: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Invalid date range.';
  const rows = storage
    .getWorkouts()
    .filter(isTraining)
    .filter((w) => { const d = localDay(w.date); return d >= from && d <= to; })
    .sort(byDateAsc)
    .slice(-60); // defensive cap on top of the char cap below
  if (rows.length === 0) return `No workouts between ${from} and ${to}.`;
  const lines = rows.map(
    (w) => `${fmtDate(w.date)} · ${w.name}${w.duration ? ` · ${w.duration}min` : ''} · ${fmtVolume(workoutVolume(w))} kg`,
  );
  return `Workouts ${from} to ${to} (${rows.length}):\n${lines.join('\n')}`;
}

function bodyWeight(days: number): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows = storage
    .getBodyWeightEntries()
    .filter((e) => new Date(e.date) >= cutoff)
    .sort(byDateAsc);
  if (rows.length === 0) return `No body weight entries in the last ${days} days.`;
  const lines = rows.map((e) => `${fmtDate(e.date)}: ${num(e.weight, 1)}kg${e.notes ? ` (${e.notes})` : ''}`);
  return `Body weight, last ${days}d (${lines.length} entries):\n${lines.join('\n')}`;
}

function streakDetail(): string {
  const summary = storage.getStreakSummary();
  const lines = summary.ladder.map(
    (r) =>
      `${r.level}★: ${r.current} week${r.current === 1 ? '' : 's'} current, ${r.longest} longest, freezes ${r.freezes}/2, this week ${r.thisWeekDays}/${r.level} days${r.thisWeekAtRisk ? ' (at risk)' : ''}`,
  );
  return `Streak ladder (committed ${summary.committed.level}★, shown ${summary.shown.level}★):\n${lines.join('\n')}`;
}

function planDetail(): string {
  const plan = storage.getActivePlan();
  if (!plan) return 'No active plan.';
  const lines = plan.days.map((d) => {
    if (d.isRestDay) return `Day ${d.dayNumber} — ${d.name}: rest day`;
    const exs = d.exercises.map((e) => `${e.exerciseName} ${e.defaultSets}x${e.defaultReps}`).join(', ');
    return `Day ${d.dayNumber} — ${d.name}: ${exs || 'no exercises'}`;
  });
  return `Active plan: ${plan.name}\n${lines.join('\n')}`;
}

function gymSummary(gym: ZenGymInput | undefined): string {
  if (!gym?.gym) return 'Not linked to a gym.';
  const { gym: g, membership, classes } = gym;
  const lines = [`Gym: ${g.name} (${g.subscriptionStatus})`];
  if (membership) {
    const status = membershipStatus(membership, new Date());
    const endsPart = membership.planEnd ? `, ends ${fmtDate(membership.planEnd)}` : '';
    const frozenPart = membership.frozen ? ', frozen' : '';
    lines.push(`Membership: ${status}${endsPart}${frozenPart}`);
    if (membership.checkinCount30d !== undefined) lines.push(`Visits (30d): ${membership.checkinCount30d}`);
    lines.push(`Role: ${membership.role}`);
  }
  if (classes && classes.length > 0) {
    const upcoming = upcomingSessions(classes, new Date(), 7).slice(0, 5);
    if (upcoming.length > 0) {
      lines.push('Upcoming classes:');
      for (const { cls, date } of upcoming) lines.push(`- ${cls.name}, ${fmtDate(date)} ${cls.startTime}`);
    }
  }
  return lines.join('\n');
}

function prs(): string {
  const records = [...storage.getPersonalRecords()].sort(byDateDesc);
  if (records.length === 0) return 'No personal records logged yet.';
  const lines = records.map((pr) => `${pr.exerciseName}: ${num(pr.weight, 2)}×${pr.reps} (${fmtDate(pr.date)})`);
  return `Personal records (${lines.length}):\n${lines.join('\n')}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Longest span a single answer may cover — the per-day cache holds 90. */
const MAX_RANGE_DAYS = 60;

/** Clamps a request's range to something the cache can actually answer. */
function boundRange(from: string, to: string): { from: string; to: string } | null {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;
  const [start, end] = from <= to ? [from, to] : [to, from];
  const earliest = addDaysISO(end, -(MAX_RANGE_DAYS - 1));
  return { from: start < earliest ? earliest : start, to: end };
}

function nutritionRange(fromRaw: string, toRaw: string): string {
  const range = boundRange(fromRaw, toRaw);
  if (!range) return 'Invalid date range.';
  return formatNutritionRange(listNutritionDays(range.from, range.to), range.from, range.to, getTargets());
}

function activityRange(fromRaw: string, toRaw: string): string {
  const range = boundRange(fromRaw, toRaw);
  if (!range) return 'Invalid date range.';
  return formatActivityRange(listActivityDays(range.from, range.to), range.from, range.to);
}

function phaseDetail(): string {
  const now = new Date();
  const to = localDateISO(now);
  return formatPhaseDetail({
    phase: getPhaseSettings(),
    targets: getTargets(),
    weights: storage.getBodyWeightEntries(),
    nutritionDays: listNutritionDays(addDaysISO(to, -20), to),
    now,
  });
}

function volumeByMuscle(weeks: number): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  const exercises = storage.getExercises();
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const totals = new Map<string, { volume: number; sets: number }>();
  for (const w of storage.getWorkouts()) {
    if (!isTraining(w)) continue;
    if (new Date(w.date) < cutoff) continue;
    for (const ex of w.exercises) {
      const def = byId.get(ex.exerciseId);
      if (!def) continue;
      const cur = totals.get(def.muscleGroup) ?? { volume: 0, sets: 0 };
      for (const s of ex.sets) {
        if (!s.completed) continue;
        cur.sets += 1;
        cur.volume += s.weight * s.reps;
      }
      totals.set(def.muscleGroup, cur);
    }
  }
  if (totals.size === 0) return `No training volume in the last ${weeks} weeks.`;
  const lines = [...totals.entries()]
    .sort((a, b) => b[1].volume - a[1].volume)
    .map(([group, t]) => `${group}: ${fmtVolume(t.volume)} kg, ${t.sets} sets`);
  return `Volume by muscle group, last ${weeks} weeks:\n${lines.join('\n')}`;
}
