import type { Exercise, MuscleGroup, Workout } from '../types';
import { computeDeloadSuggestion, excludeDeloadWorkouts } from '../deloadDetector';
import { addDays, localIso, weekStartISO } from '../streakService';
import { byDateAsc, daysBetween, nameKey, setsVolume, workoutVolume } from '../zen/format';

/**
 * The Analysis engine — everything the Analysis screen says about a
 * lifter's last few weeks, as one pure function of their history.
 *
 * Design rules, same as `coachService.ts`:
 *   - Pure. Same (workouts, exercises, window, commitment, now) in, same
 *     report out. No storage, no network, no `new Date()` except the
 *     caller's `now`. That is what makes the whole screen testable.
 *   - Local-day date maths only. `toISOString().slice(0,10)` eats a day
 *     for everyone east of Greenwich.
 *   - Deload weeks are left out of every comparison (`excludeDeloadWorkouts`).
 *     A deliberately light week is planned recovery, not a slump, and
 *     counting it would fake a drop and then a fake "rising streak" the
 *     moment the lifter climbs back to normal.
 *   - Nothing is claimed from one data point. Every threshold below is a
 *     stated judgement, not a fact, and each one is written into the
 *     explainer copy the screen shows.
 */

// ---------- windows ----------

export type AnalysisWindow = '4w' | '12w' | 'all';

export const ANALYSIS_WINDOWS: readonly AnalysisWindow[] = ['4w', '12w', 'all'];

export const WINDOW_LABEL: Record<AnalysisWindow, string> = {
  '4w': '4 weeks',
  '12w': '12 weeks',
  all: 'All time',
};

/** Weeks the window covers, counting this one. `null` = since the first workout. */
const WINDOW_WEEKS: Record<AnalysisWindow, number | null> = { '4w': 4, '12w': 12, all: null };

// ---------- thresholds (all judgement calls, all explained in the UI) ----------

/** Below this, a change in weekly volume is week-to-week noise, not a trend. */
export const TREND_BAND_PCT = 7.5;
/** Epley is honest in the strength rep range; above this it flatters the lifter. */
const MAX_E1RM_REPS = 12;
/** An e1RM within this much of the best counts as the same — plates come in 2.5 kg. */
const E1RM_BAND_PCT = 2.5;
/** Sessions without a new best before we call it a plateau … */
const PLATEAU_SESSIONS = 3;
/** … and the sessions of history needed before that claim is worth making. */
const PLATEAU_MIN_SESSIONS = 4;
/** Exercises shown in the Strength section, ranked by how often they were trained. */
const TOP_EXERCISES = 6;
/** Below this share of total volume a main muscle group counts as neglected. */
const NEGLECT_SHARE_PCT = 5;
/** Push vs pull: the lighter side must be at least this much of the heavier. */
const BALANCE_FLOOR = 0.6;
/** Too little volume on a side to compare it honestly, kg (matches coachService). */
const MIN_GROUP_VOLUME = 1000;
/** A session at or under this share of the usual load for its exercises reads as light. */
const LIGHT_SESSION_RATIO = 0.7;
/** Adherence under this is worth an action rather than a pat on the back. */
const ADHERENCE_TARGET_PCT = 80;
/** A stretch of empty days this long is the thing to fix first. */
const LONG_GAP_DAYS = 7;
/** Actions shown. More than this and none of them get done. */
const MAX_ACTIONABLES = 6;
/** Neglected groups worth listing as actions; the rest stay in the balance card. */
const MAX_NEGLECT_ACTIONS = 2;

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps',
  triceps: 'Triceps', legs: 'Legs', core: 'Core', full_body: 'Full body', other: 'Other',
};

const PUSH_GROUPS: readonly MuscleGroup[] = ['chest', 'shoulders', 'triceps'];
const PULL_GROUPS: readonly MuscleGroup[] = ['back', 'biceps'];
const MAIN_GROUPS: readonly MuscleGroup[] = ['chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps'];

// ---------- report shape ----------

export interface WeekPoint {
  /** Local YYYY-MM-DD of the Sunday that starts the week. */
  start: string;
  volume: number;
  /** Distinct days trained that week. */
  days: number;
}

export type TrendDirection = 'rising' | 'flat' | 'falling';

export interface Trend {
  direction: TrendDirection;
  /** Null when there are too few weeks to compare halves. */
  changePct: number | null;
  /** Mean weekly volume of the older half and the newer half, kg. */
  firstHalf: number;
  secondHalf: number;
}

export interface LoadSummary {
  /** Every week in the window, oldest first, empty weeks included. */
  weeks: WeekPoint[];
  totalVolume: number;
  sessions: number;
  sessionsPerWeek: number;
  /** Null when no session recorded a duration. */
  avgDurationMin: number | null;
  trend: Trend;
}

export interface ConsistencySummary {
  /** Days/week the lifter committed to (streakService.resolveCommitment). */
  commitment: number;
  /** Weeks the adherence figure is measured over — the current, unfinished week is left out. */
  weeksCounted: number;
  trainingDays: number;
  adherencePct: number;
  weeksMet: number;
  weeks: Array<{ start: string; days: number; met: boolean; partial: boolean }>;
  /** Longest run of days with no workout, including the run up to today. */
  longestGapDays: number;
  daysSinceLast: number | null;
  /** Most-trained days of the week, busiest first. */
  topDays: Array<{ day: number; label: string; count: number }>;
  /** Hour of day (0–23) most sessions start at, or null when no session recorded a time. */
  topHour: number | null;
}

export interface StrengthPoint {
  date: string;
  e1rm: number;
  weight: number;
  reps: number;
}

export interface ExerciseStrength {
  key: string;
  name: string;
  /** Sessions inside the window. */
  sessions: number;
  /** e1RM per session inside the window, oldest first. */
  points: StrengthPoint[];
  first: number;
  latest: number;
  best: number;
  /** Latest against the first session in the window; null with a single point. */
  changePct: number | null;
  status: 'improving' | 'flat' | 'declining';
  /** Sessions logged since the best e1RM of the window. */
  sessionsSinceBest: number;
  plateau: boolean;
}

export interface PrHit {
  key: string;
  name: string;
  date: string;
  e1rm: number;
  weight: number;
  reps: number;
}

export interface StrengthSummary {
  exercises: ExerciseStrength[];
  /** All-time bests set inside the window, newest first. */
  prs: PrHit[];
}

export interface GroupShare {
  group: MuscleGroup;
  label: string;
  volume: number;
  /** Percent of matched volume. */
  share: number;
}

export type BalanceFlagKind = 'push-pull' | 'neglected';

export interface BalanceFlag {
  kind: BalanceFlagKind;
  title: string;
  detail: string;
  tag: string;
}

export interface BalanceSummary {
  groups: GroupShare[];
  /** Volume from exercises that are not in the library, kg — left out of the shares. */
  unmatchedVolume: number;
  push: number;
  pull: number;
  flags: BalanceFlag[];
}

export interface LightSession {
  date: string;
  name: string;
  /** Where the session landed against the usual load for its exercises, 0–1. */
  ratio: number;
}

export interface RecoverySummary {
  risingStreak: number;
  recommendDeload: boolean;
  /** Volume to aim for in a lighter week, kg. */
  targetVolume: number;
  weeklyVolumes: number[];
  lightSessions: LightSession[];
}

export type ActionableKind =
  | 'consistency' | 'gap' | 'deload' | 'balance' | 'neglected' | 'plateau' | 'decline' | 'trend';

export interface Actionable {
  id: string;
  kind: ActionableKind;
  /** The action itself, in plain words. */
  title: string;
  /** Why, with the number behind it. */
  detail: string;
  /** How the app spotted it — the rule, in words. */
  method: string;
  /** What to aim for. */
  good: string;
  /** Higher goes first. */
  priority: number;
  /** A ready-made question for Zen. */
  ask: string;
  tag?: string;
}

export interface AnalysisReport {
  window: AnalysisWindow;
  label: string;
  /** Local YYYY-MM-DD the window starts on, null when there is no history. */
  from: string | null;
  to: string;
  sessions: number;
  /** Three sessions is the floor for saying anything at all (same bar as the Coach). */
  hasEnoughData: boolean;
  load: LoadSummary;
  consistency: ConsistencySummary;
  strength: StrengthSummary;
  balance: BalanceSummary;
  recovery: RecoverySummary;
  actionables: Actionable[];
}

export interface AnalysisInput {
  workouts: readonly Workout[];
  exercises: readonly Exercise[];
  window: AnalysisWindow;
  commitment: number;
  now?: Date;
}

// ---------- small shared maths ----------

/** Epley: the one-rep max a set of `reps` at `weight` implies. */
export function epley1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function pctChange(from: number, to: number): number | null {
  if (from <= 0) return null;
  return round(((to - from) / from) * 100);
}

/** A workout that counts: finished, not a rest day, not a deload week. */
function isTrainingSession(w: Workout): boolean {
  return w.completed && w.type !== 'rest';
}

/**
 * The identity an exercise is counted under. Ids drift — a workout logged
 * in a buddy session carries the host's ids — so the library is consulted
 * by id first and by name second, and anything unknown falls back to its
 * own name.
 */
interface ExerciseIdentity {
  key: string;
  name: string;
  group: MuscleGroup | null;
}

function identify(
  exerciseId: string,
  exerciseName: string,
  byId: Map<string, Exercise>,
  byName: Map<string, Exercise>,
): ExerciseIdentity {
  const def = byId.get(exerciseId) ?? byName.get(nameKey(exerciseName));
  if (def) return { key: def.id, name: def.name, group: def.muscleGroup };
  return { key: `name:${nameKey(exerciseName)}`, name: exerciseName, group: null };
}

/** Best e1RM of one performance. Sets above {@link MAX_E1RM_REPS} reps are
 *  only used when the exercise was trained no other way — a 20-rep set says
 *  something about the trend even if Epley overstates the number. */
function sessionE1RM(sets: readonly { weight: number; reps: number; completed: boolean }[]): StrengthPoint | null {
  let best: StrengthPoint | null = null;
  let fallback: StrengthPoint | null = null;
  for (const s of sets) {
    if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
    const point: StrengthPoint = { date: '', e1rm: epley1RM(s.weight, s.reps), weight: s.weight, reps: s.reps };
    if (s.reps <= MAX_E1RM_REPS) {
      if (!best || point.e1rm > best.e1rm) best = point;
    } else if (!fallback || point.e1rm > fallback.e1rm) {
      fallback = point;
    }
  }
  return best ?? fallback;
}

// ---------- the report ----------

export function buildAnalysis(input: AnalysisInput): AnalysisReport {
  const now = input.now ?? new Date();
  const today = localIso(now);
  const thisWeekStart = weekStartISO(now);

  // Deloads out first: every comparison below is week against week.
  const history = excludeDeloadWorkouts([...input.workouts])
    .filter(isTrainingSession)
    .sort(byDateAsc);

  const weeks = WINDOW_WEEKS[input.window];
  const firstStart = history.length ? weekStartISO(new Date(history[0].date)) : thisWeekStart;
  const from = weeks ? maxISO(addDays(thisWeekStart, -(weeks - 1) * 7), history.length ? firstStart : thisWeekStart)
    : firstStart;

  const inWindow = history.filter((w) => localIso(new Date(w.date)) >= from);

  const byId = new Map(input.exercises.map((e) => [e.id, e]));
  const byName = new Map(input.exercises.map((e) => [nameKey(e.name), e]));

  const load = summariseLoad(inWindow, from, thisWeekStart);
  const consistency = summariseConsistency(inWindow, load.weeks, input.commitment, today, thisWeekStart);
  const strength = summariseStrength(history, from, byId, byName);
  const balance = summariseBalance(inWindow, byId, byName);
  const recovery = summariseRecovery(input.workouts, inWindow, byId, byName);

  const report: Omit<AnalysisReport, 'actionables'> = {
    window: input.window,
    label: WINDOW_LABEL[input.window],
    from: history.length ? from : null,
    to: today,
    sessions: inWindow.length,
    hasEnoughData: inWindow.length >= 3,
    load,
    consistency,
    strength,
    balance,
    recovery,
  };

  return { ...report, actionables: buildActionables(report) };
}

function maxISO(a: string, b: string): string {
  return a > b ? a : b;
}

// ---------- training load ----------

function summariseLoad(inWindow: Workout[], from: string, thisWeekStart: string): LoadSummary {
  const buckets = new Map<string, { volume: number; days: Set<string> }>();
  for (let start = from; start <= thisWeekStart; start = addDays(start, 7)) {
    buckets.set(start, { volume: 0, days: new Set() });
  }

  let totalVolume = 0;
  const durations: number[] = [];
  for (const w of inWindow) {
    const date = new Date(w.date);
    const bucket = buckets.get(weekStartISO(date));
    const volume = workoutVolume(w);
    totalVolume += volume;
    if (w.duration && w.duration > 0) durations.push(w.duration);
    if (!bucket) continue;
    bucket.volume += volume;
    bucket.days.add(localIso(date));
  }

  const weekPoints: WeekPoint[] = [...buckets.entries()].map(([start, b]) => ({
    start, volume: Math.round(b.volume), days: b.days.size,
  }));

  return {
    weeks: weekPoints,
    totalVolume: Math.round(totalVolume),
    sessions: inWindow.length,
    sessionsPerWeek: weekPoints.length ? round(inWindow.length / weekPoints.length) : 0,
    avgDurationMin: durations.length ? Math.round(mean(durations)) : null,
    trend: weeklyTrend(weekPoints.map((w) => w.volume)),
  };
}

/**
 * Older half of the window against the newer half. Halves, not first week
 * against last week: a single big session should not read as a trend. With
 * an odd number of weeks the middle week is dropped so the two halves are
 * the same length.
 */
export function weeklyTrend(volumes: number[]): Trend {
  if (volumes.length < 4) return { direction: 'flat', changePct: null, firstHalf: 0, secondHalf: 0 };
  const half = Math.floor(volumes.length / 2);
  const firstHalf = round(mean(volumes.slice(0, half)), 0);
  const secondHalf = round(mean(volumes.slice(volumes.length - half)), 0);
  const changePct = pctChange(firstHalf, secondHalf);
  if (changePct == null) return { direction: 'flat', changePct: null, firstHalf, secondHalf };
  const direction: TrendDirection =
    changePct >= TREND_BAND_PCT ? 'rising' : changePct <= -TREND_BAND_PCT ? 'falling' : 'flat';
  return { direction, changePct, firstHalf, secondHalf };
}

// ---------- consistency ----------

function summariseConsistency(
  inWindow: Workout[],
  weekPoints: WeekPoint[],
  commitment: number,
  today: string,
  thisWeekStart: string,
): ConsistencySummary {
  const weeks = weekPoints.map((w) => ({
    start: w.start,
    days: w.days,
    met: w.days >= commitment,
    partial: w.start === thisWeekStart,
  }));

  // The week in progress is not a miss — it has not finished yet. It only
  // counts towards adherence when it is the only week there is.
  const finished = weeks.filter((w) => !w.partial);
  const counted = finished.length > 0 ? finished : weeks;
  const trainingDays = counted.reduce((sum, w) => sum + w.days, 0);
  const target = commitment * counted.length;

  const days = [...new Set(inWindow.map((w) => localIso(new Date(w.date))))].sort();
  let longestGapDays = 0;
  for (let i = 1; i < days.length; i++) {
    longestGapDays = Math.max(longestGapDays, daysBetween(days[i - 1], days[i]) - 1);
  }
  const last = days[days.length - 1];
  const daysSinceLast = last ? daysBetween(last, today) : null;
  if (daysSinceLast != null) longestGapDays = Math.max(longestGapDays, daysSinceLast - 1);

  const dayCounts = new Array(7).fill(0) as number[];
  for (const d of days) dayCounts[new Date(d + 'T00:00:00').getDay()]++;
  const topDays = dayCounts
    .map((count, day) => ({ day, label: DAY_LABELS[day], count }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count || a.day - b.day);

  const hourCounts = new Map<number, number>();
  for (const w of inWindow) {
    const stamp = w.startedAt ?? (w.date.includes('T') ? w.date : null);
    if (!stamp) continue;
    const d = new Date(stamp);
    if (Number.isNaN(d.getTime())) continue;
    hourCounts.set(d.getHours(), (hourCounts.get(d.getHours()) ?? 0) + 1);
  }
  const topHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;

  return {
    commitment,
    weeksCounted: counted.length,
    trainingDays,
    adherencePct: target > 0 ? Math.round((trainingDays / target) * 100) : 0,
    weeksMet: counted.filter((w) => w.met).length,
    weeks,
    longestGapDays: Math.max(0, longestGapDays),
    daysSinceLast,
    topDays: topDays.slice(0, 3),
    topHour,
  };
}

// ---------- strength ----------

function summariseStrength(
  history: Workout[],
  from: string,
  byId: Map<string, Exercise>,
  byName: Map<string, Exercise>,
): StrengthSummary {
  // The full series, not just the window: a personal best is an all-time
  // best, so the window can only decide which of them to show.
  const series = new Map<string, { name: string; points: StrengthPoint[] }>();
  for (const w of history) {
    const date = localIso(new Date(w.date));
    for (const ex of w.exercises) {
      const point = sessionE1RM(ex.sets);
      if (!point) continue;
      const id = identify(ex.exerciseId, ex.exerciseName, byId, byName);
      const entry = series.get(id.key) ?? { name: id.name, points: [] };
      entry.points.push({ ...point, date });
      series.set(id.key, entry);
    }
  }

  const prs: PrHit[] = [];
  const exercises: ExerciseStrength[] = [];

  for (const [key, entry] of series) {
    let bestSoFar = 0;
    for (const p of entry.points) {
      if (p.e1rm > bestSoFar) {
        bestSoFar = p.e1rm;
        if (p.date >= from) prs.push({ key, name: entry.name, date: p.date, e1rm: round(p.e1rm), weight: p.weight, reps: p.reps });
      }
    }

    const points = entry.points.filter((p) => p.date >= from);
    if (points.length === 0) continue;

    const values = points.map((p) => p.e1rm);
    const best = Math.max(...values);
    const first = values[0];
    const latest = values[values.length - 1];
    const changePct = points.length >= 2 ? pctChange(first, latest) : null;
    // First time the best was reached: the question is "how long since a NEW
    // best", so repeating it does not restart the clock.
    const bestIndex = values.indexOf(best);
    const sessionsSinceBest = values.length - 1 - bestIndex;

    exercises.push({
      key,
      name: entry.name,
      sessions: points.length,
      points: points.map((p) => ({ ...p, e1rm: round(p.e1rm) })),
      first: round(first),
      latest: round(latest),
      best: round(best),
      changePct,
      status: changePct == null || Math.abs(changePct) < E1RM_BAND_PCT
        ? 'flat'
        : changePct > 0 ? 'improving' : 'declining',
      sessionsSinceBest,
      plateau: points.length >= PLATEAU_MIN_SESSIONS && sessionsSinceBest >= PLATEAU_SESSIONS,
    });
  }

  exercises.sort((a, b) => b.sessions - a.sessions || b.best - a.best || a.name.localeCompare(b.name));
  prs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  // Two performances is the floor for drawing a line between them.
  return { exercises: exercises.filter((e) => e.sessions >= 2).slice(0, TOP_EXERCISES), prs };
}

// ---------- muscle balance ----------

function summariseBalance(
  inWindow: Workout[],
  byId: Map<string, Exercise>,
  byName: Map<string, Exercise>,
): BalanceSummary {
  const totals = new Map<MuscleGroup, number>();
  let unmatchedVolume = 0;

  for (const w of inWindow) {
    for (const ex of w.exercises) {
      const volume = setsVolume(ex.sets);
      if (volume <= 0) continue;
      const { group } = identify(ex.exerciseId, ex.exerciseName, byId, byName);
      if (!group) { unmatchedVolume += volume; continue; }
      totals.set(group, (totals.get(group) ?? 0) + volume);
    }
  }

  const matched = [...totals.values()].reduce((a, b) => a + b, 0);
  const groups: GroupShare[] = [...totals.entries()]
    .map(([group, volume]) => ({
      group,
      label: MUSCLE_LABEL[group],
      volume: Math.round(volume),
      share: matched > 0 ? round((volume / matched) * 100) : 0,
    }))
    .sort((a, b) => b.volume - a.volume);

  const push = Math.round(PUSH_GROUPS.reduce((sum, g) => sum + (totals.get(g) ?? 0), 0));
  const pull = Math.round(PULL_GROUPS.reduce((sum, g) => sum + (totals.get(g) ?? 0), 0));
  const flags: BalanceFlag[] = [];

  const heavier = Math.max(push, pull);
  const lighter = Math.min(push, pull);
  if (heavier >= MIN_GROUP_VOLUME && lighter / heavier < BALANCE_FLOOR) {
    const pushLeads = push > pull;
    const ratio = Math.round((lighter / heavier) * 100);
    flags.push({
      kind: 'push-pull',
      tag: pushLeads ? 'pull' : 'push',
      title: pushLeads ? 'Pulling is behind pressing' : 'Pressing is behind pulling',
      detail: `${pushLeads ? 'Pull' : 'Push'} volume is ${ratio}% of ${pushLeads ? 'push' : 'pull'} volume. Keeping the two close protects the shoulders.`,
    });
  }

  if (matched > 0) {
    // Thinnest first — a group at 0% is a bigger hole than one at 4%.
    const neglected = MAIN_GROUPS
      .map((group) => ({ group, share: ((totals.get(group) ?? 0) / matched) * 100 }))
      .filter((g) => g.share < NEGLECT_SHARE_PCT)
      .sort((a, b) => a.share - b.share);
    for (const { group, share } of neglected) {
      flags.push({
        kind: 'neglected',
        tag: group,
        title: `${MUSCLE_LABEL[group]} is barely trained`,
        detail: `${MUSCLE_LABEL[group]} is ${round(share)}% of your lifted weight in this window.`,
      });
    }
  }

  return { groups, unmatchedVolume: Math.round(unmatchedVolume), push, pull, flags };
}

// ---------- recovery ----------

function summariseRecovery(
  allWorkouts: readonly Workout[],
  inWindow: Workout[],
  byId: Map<string, Exercise>,
  byName: Map<string, Exercise>,
): RecoverySummary {
  const deload = computeDeloadSuggestion([...allWorkouts]);

  // Per-exercise medians, so a leg day is judged against leg days rather
  // than against the heaviest session of the window.
  const perExercise = new Map<string, number[]>();
  for (const w of inWindow) {
    for (const ex of w.exercises) {
      const volume = setsVolume(ex.sets);
      if (volume <= 0) continue;
      const { key } = identify(ex.exerciseId, ex.exerciseName, byId, byName);
      const list = perExercise.get(key) ?? [];
      list.push(volume);
      perExercise.set(key, list);
    }
  }
  const medians = new Map<string, number>();
  for (const [key, values] of perExercise) {
    if (values.length >= 3) medians.set(key, median(values));
  }

  const lightSessions: LightSession[] = [];
  for (const w of inWindow) {
    const ratios: number[] = [];
    for (const ex of w.exercises) {
      const volume = setsVolume(ex.sets);
      if (volume <= 0) continue;
      const { key } = identify(ex.exerciseId, ex.exerciseName, byId, byName);
      const med = medians.get(key);
      if (med && med > 0) ratios.push(volume / med);
    }
    if (ratios.length < 2) continue;
    const ratio = median(ratios);
    if (ratio <= LIGHT_SESSION_RATIO) {
      lightSessions.push({ date: localIso(new Date(w.date)), name: w.name, ratio: round(ratio, 2) });
    }
  }
  lightSessions.reverse();

  return {
    risingStreak: deload.risingStreak,
    recommendDeload: deload.recommend,
    targetVolume: deload.targetVolume,
    weeklyVolumes: deload.weeklyVolumes,
    lightSessions: lightSessions.slice(0, 3),
  };
}

// ---------- what to do next ----------

/**
 * The ranked list of actions. Priority is "how much does fixing this
 * change the next month": showing up beats balance, balance beats a
 * single stalled lift. Nothing is invented to pad the list — a lifter
 * with nothing to fix is told so rather than handed filler.
 */
export function buildActionables(report: Omit<AnalysisReport, 'actionables'>): Actionable[] {
  const out: Actionable[] = [];
  const { consistency, load, balance, strength, recovery } = report;

  if (!report.hasEnoughData) return out;

  if (consistency.weeksCounted >= 2 && consistency.adherencePct < ADHERENCE_TARGET_PCT) {
    const perWeek = round(consistency.trainingDays / consistency.weeksCounted);
    out.push({
      id: 'consistency',
      kind: 'consistency',
      priority: 95,
      title: `Get back to ${consistency.commitment} sessions a week`,
      detail: `You trained ${perWeek} day${perWeek === 1 ? '' : 's'} a week over the last ${consistency.weeksCounted} week${consistency.weeksCounted === 1 ? '' : 's'} against a ${consistency.commitment}-day commitment — ${consistency.adherencePct}% of the plan.`,
      method: 'Distinct days you trained, divided by your committed days a week. The week in progress is left out until it finishes.',
      good: 'Above 80%. Missing one session in five is recoverable; missing one in three changes what your training can do.',
      ask: `I have been training ${perWeek} days a week against a ${consistency.commitment}-day plan. How do I get back on track?`,
    });
  }

  if (recovery.recommendDeload) {
    out.push({
      id: 'deload',
      kind: 'deload',
      priority: 90,
      title: 'Take a lighter week',
      detail: `Your weekly volume has risen ${recovery.risingStreak} weeks in a row. A week at about ${Math.round(recovery.targetVolume / 1000)}t lets the last block land.`,
      method: 'Total weight lifted per week over the last four weeks. Three straight increases is the trigger; deload weeks are not counted.',
      good: 'Roughly 60% of your usual load for one week — same movements, lighter sets, then back to normal.',
      ask: 'My volume has been climbing for several weeks. Should I deload, and what should the week look like?',
    });
  }

  if (consistency.longestGapDays >= LONG_GAP_DAYS) {
    out.push({
      id: 'gap',
      kind: 'gap',
      priority: 86,
      title: 'Close the long gaps',
      detail: `Your longest stretch without training in this window was ${consistency.longestGapDays} days.`,
      method: 'The longest run of days with no completed workout, including the days since your last session.',
      good: 'Under 4 days. Strength holds for about a week; past that you spend the next session catching up.',
      ask: `I had a ${consistency.longestGapDays}-day gap in my training. How should I come back from it?`,
    });
  }

  // Two neglected groups at most. A narrow split leaves four or five groups
  // thin, and a list that is nothing but "train your calves" gets ignored.
  let neglectedShown = 0;
  for (const flag of balance.flags) {
    if (flag.kind === 'neglected' && neglectedShown++ >= MAX_NEGLECT_ACTIONS) continue;
    if (flag.kind === 'push-pull') {
      out.push({
        id: `balance-${flag.tag}`,
        kind: 'balance',
        priority: 80,
        tag: flag.tag,
        title: flag.tag === 'pull' ? 'Add a row or pulldown' : 'Add a press',
        detail: flag.detail,
        method: 'Weight lifted on chest, shoulders and triceps against back and biceps, over this window. Only counted once one side clears 1,000 kg.',
        good: 'The lighter side at 60% of the heavier or more. Near 1:1 is ideal for shoulder health.',
        ask: `My ${flag.tag === 'pull' ? 'pull' : 'push'} volume is well behind. What should I add to my week?`,
      });
    } else {
      out.push({
        id: `neglected-${flag.tag}`,
        kind: 'neglected',
        priority: 66,
        tag: flag.tag,
        title: `Give ${flag.tag} a session`,
        detail: flag.detail,
        method: 'Each main muscle group\'s share of the weight you lifted in this window. Under 5% counts as neglected.',
        good: 'Every main group above 5% of your volume, with the big groups higher.',
        ask: `${flag.tag.charAt(0).toUpperCase()}${flag.tag.slice(1)} is barely in my training. What should I add?`,
      });
    }
  }

  for (const ex of strength.exercises) {
    if (ex.status === 'declining' && ex.changePct != null) {
      out.push({
        id: `decline-${ex.key}`,
        kind: 'decline',
        priority: 76,
        tag: ex.name,
        title: `${ex.name} is going backwards`,
        detail: `Your estimated one-rep max is down ${Math.abs(ex.changePct)}% across ${ex.sessions} sessions, from ${ex.first} kg to ${ex.latest} kg.`,
        method: 'The best set of each session turned into a one-rep max with the Epley formula, then the latest session compared with the first in this window.',
        good: 'Flat or rising. A drop usually means sleep, food or fatigue before it means the programme.',
        ask: `My ${ex.name} estimated one-rep max has dropped from ${ex.first} kg to ${ex.latest} kg. What should I look at?`,
      });
    } else if (ex.plateau) {
      out.push({
        id: `plateau-${ex.key}`,
        kind: 'plateau',
        priority: 70,
        tag: ex.name,
        title: `Change the rep range on ${ex.name}`,
        detail: `No new best in the last ${ex.sessionsSinceBest} sessions — stuck around ${ex.best} kg estimated one-rep max.`,
        method: 'Sessions logged since your best estimated one-rep max in this window. Three or more, with at least four sessions of history, counts as a plateau.',
        good: 'A new best every three to six sessions early on, slowing as you get stronger. Three weeks in a new rep range usually restarts it.',
        ask: `My ${ex.name} has been stuck at about ${ex.best} kg estimated one-rep max. How do I break the plateau?`,
      });
    }
  }

  const consistencyFired = out.some((a) => a.kind === 'consistency');
  if (!consistencyFired && load.trend.direction === 'falling' && load.trend.changePct != null) {
    out.push({
      id: 'trend',
      kind: 'trend',
      priority: 64,
      title: 'Build the volume back up',
      detail: `Weekly volume is down ${Math.abs(load.trend.changePct)}% over the second half of this window.`,
      method: 'Average weekly weight lifted in the older half of the window against the newer half. Under 7.5% either way is normal week-to-week noise.',
      good: 'Flat or slowly rising. A steady climb of a few percent a week is what progress looks like.',
      ask: 'My weekly training volume has been falling. How do I build it back up without overdoing it?',
    });
  }

  out.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return out.slice(0, MAX_ACTIONABLES);
}
