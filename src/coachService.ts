import type { Workout, Exercise, BodyWeightEntry, BodyMeasurementEntry, WeeklyPlan, MuscleGroup, PersonalRecord } from './types';
import * as storage from './storage';
import { computeWeekStreak, getStreakState, weekStartISO, MAX_FREEZES, daysUntilNextFreeze } from './streakService';

/**
 * Rule-based "Coach" — runs heuristics over the user's local workout
 * history and emits actionable insights without calling any AI / LLM.
 *
 * Design principles:
 *   - Pure functions of (workouts, exercises, body weights, plan).
 *     Idempotent: same inputs → same outputs.
 *   - Insights are ranked by `priority`. The Coach view sorts and shows
 *     the top N to keep the surface tidy.
 *   - Every insight has to clear "is this useful and timely?" or it's
 *     not emitted at all. Better to show 3 strong cards than 12 fillers.
 *   - Date math is timezone-safe — we work in local-day strings, not
 *     ISO UTC slices, because IST + UTC slicing eats a day every time.
 */

// ----- Types --------------------------------------------------------------

export type InsightSeverity = 'positive' | 'neutral' | 'warning' | 'concern';

export type InsightKind =
  | 'plateau'
  | 'progression'
  | 'regression'
  | 'volume-imbalance'
  | 'muscle-neglected'
  | 'muscle-on-pace'
  | 'frequency-low'
  | 'frequency-strong'
  | 'recent-deload'
  | 'goal-pacing-bw'
  | 'goal-pacing-lift'
  | 'next-workout'
  | 'pr-celebration'
  | 'rest-overdue';

export interface Insight {
  /** Stable id for React keys. */
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  body: string;
  /** Higher = more important. Within a severity bucket, sort by this. */
  priority: number;
  /** Optional sparkline values, oldest → newest. The card renders a
   *  small inline trend graphic when present. */
  sparkline?: number[];
  /** Optional headline metric (e.g. "+7.5kg" / "in 4 weeks"). */
  metric?: { value: string; label: string };
  /** Optional context tag (exercise, muscle group, plan day). */
  tag?: string;
}

export interface WeeklySummary {
  /** Number of completed (non-rest) workouts this Sun→Sat week. */
  sessions: number;
  /** Total volume kg this week. */
  volume: number;
  /** Volume change vs last week (signed kg). */
  volumeDelta: number;
  /** PRs (top weight on any exercise) hit this week. */
  prsThisWeek: number;
  /** Streak label, derived from streakService for context. */
  streakWeeks?: number;
  /** Weekly volumes for the last 8 weeks, oldest → newest, used by the
   *  summary card sparkline. */
  weeklyVolumes: number[];
}

export interface CoachContext {
  workouts: Workout[];
  exercises: Exercise[];
  bodyWeights: BodyWeightEntry[];
  activePlan: WeeklyPlan | null;
  lastUsedDay: number | null;
}

export interface CoachReport {
  insights: Insight[];
  weekly: WeeklySummary;
  hasEnoughData: boolean;
}

// ----- Public entry points -------------------------------------------------

/**
 * Build a complete coach report from local storage. Convenience wrapper
 * over `buildReportFromContext` that pulls everything from `storage`.
 */
export function buildCoachReport(): CoachReport {
  const ctx: CoachContext = {
    workouts: storage.getWorkouts().filter((w) => w.completed),
    exercises: storage.getExercises(),
    bodyWeights: storage.getBodyWeightEntries(),
    activePlan: storage.getActivePlan(),
    lastUsedDay: storage.getLastUsedDay(),
  };
  return buildReportFromContext(ctx);
}

export function buildReportFromContext(ctx: CoachContext): CoachReport {
  // "Enough data" = at least 3 completed non-rest workouts. Fewer than
  // that and nothing useful can be said — show empty state instead.
  const trainingWorkouts = ctx.workouts.filter((w) => w.type !== 'rest');
  const hasEnoughData = trainingWorkouts.length >= 3;

  const weekly = computeWeeklySummary(ctx.workouts);

  if (!hasEnoughData) {
    return { insights: [], weekly, hasEnoughData: false };
  }

  const insights: Insight[] = [
    ...detectPlateausAndProgression(ctx),
    ...analyzeVolumeBalance(ctx),
    ...analyzeMuscleFrequency(ctx),
    ...analyzeFrequency(ctx),
    ...paceGoals(ctx),
    ...suggestNextWorkout(ctx),
    ...recentPRCelebration(ctx),
  ];

  insights.sort(rankInsights);
  return { insights, weekly, hasEnoughData: true };
}

// ----- Helpers: dates ------------------------------------------------------

/** YYYY-MM-DD in LOCAL time. ISO slicing ate a day for IST users in
 *  several places before this helper landed. */
export function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Sunday-anchored week start as YYYY-MM-DD (matches streakService). */
function weekStartLocal(d: Date): string {
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  start.setHours(0, 0, 0, 0);
  return localISO(start);
}

function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO + 'T00:00:00');
  const b = new Date(bISO + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ----- Helpers: workout math -----------------------------------------------

/** Return the top working-set weight in a workout's instance of an
 *  exercise. We use top weight (heaviest completed set) as the "score"
 *  for plateau detection — total volume is too noisy at the per-session
 *  level (changes with set count) to make a clean trend. */
function topSetWeight(workout: Workout, exerciseId: string): { weight: number; reps: number } | null {
  let best: { weight: number; reps: number } | null = null;
  for (const ex of workout.exercises) {
    if (ex.exerciseId !== exerciseId) continue;
    for (const s of ex.sets) {
      if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
      if (!best || s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps)) {
        best = { weight: s.weight, reps: s.reps };
      }
    }
  }
  return best;
}

/** Sum total volume (Σ weight·reps over completed sets) for a workout. */
function workoutVolume(workout: Workout): number {
  if (workout.type === 'rest') return 0;
  let v = 0;
  for (const ex of workout.exercises) {
    for (const s of ex.sets) {
      if (s.completed) v += s.weight * s.reps;
    }
  }
  return v;
}

function rankInsights(a: Insight, b: Insight): number {
  const order: Record<InsightSeverity, number> = { concern: 0, warning: 1, neutral: 2, positive: 3 };
  if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
  return b.priority - a.priority;
}

/** Simple ordinary least squares regression on (xs, ys). Returns slope
 *  and intercept; xs are typically 0..n-1 (session index). */
function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumXX += xs[i] * xs[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function formatPlusMinus(kg: number): string {
  const sign = kg > 0 ? '+' : kg < 0 ? '−' : '±';
  return `${sign}${Math.abs(kg).toFixed(1).replace(/\.0$/, '')}kg`;
}

// ----- Plateau / progression / regression ---------------------------------

const PLATEAU_LOOKBACK_DAYS = 90;
const PLATEAU_MIN_SESSIONS = 4;

export function detectPlateausAndProgression(ctx: CoachContext): Insight[] {
  const out: Insight[] = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - PLATEAU_LOOKBACK_DAYS);
  const cutoffISO = localISO(cutoff);

  // Group sessions per exercise. We only consider compound / "main"
  // lifts (isCompound) — plateau on triceps pushdowns isn't actionable
  // and creates noise.
  const byExercise = new Map<string, { exercise: Exercise; rows: Array<{ date: string; weight: number; reps: number }> }>();
  const exerciseById = new Map(ctx.exercises.map((e) => [e.id, e]));

  const sortedWorkouts = ctx.workouts
    .filter((w) => w.type !== 'rest' && localISO(new Date(w.date)) >= cutoffISO)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (const w of sortedWorkouts) {
    for (const ex of w.exercises) {
      const def = exerciseById.get(ex.exerciseId);
      if (!def) continue;
      if (!def.isCompound && def.category !== 'compound') continue;
      const top = topSetWeight(w, ex.exerciseId);
      if (!top) continue;
      let bucket = byExercise.get(ex.exerciseId);
      if (!bucket) {
        bucket = { exercise: def, rows: [] };
        byExercise.set(ex.exerciseId, bucket);
      }
      bucket.rows.push({ date: localISO(new Date(w.date)), weight: top.weight, reps: top.reps });
    }
  }

  for (const { exercise, rows } of byExercise.values()) {
    if (rows.length < PLATEAU_MIN_SESSIONS) continue;

    // Only compute on the most recent up-to-8 sessions. Old data dilutes
    // the picture — if you plateaued in March but PR'd in April we want
    // the April story.
    const recent = rows.slice(-8);
    const ys = recent.map((r) => r.weight);
    const xs = recent.map((_, i) => i);
    const { slope } = linearRegression(xs, ys);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const range = maxY - minY;
    const avgY = ys.reduce((s, v) => s + v, 0) / ys.length;

    // Total change predicted by the trend across the window
    const predictedChange = slope * (recent.length - 1);

    // PROGRESSION: trend up by at least 5% of avg weight (or ≥5kg)
    const progressionThreshold = Math.max(5, avgY * 0.05);
    const regressionThreshold = -Math.max(5, avgY * 0.05);
    // PLATEAU: trend nearly flat AND data range tight (≤3kg) over ≥4 sessions
    const isPlateau = Math.abs(predictedChange) < Math.max(2.5, avgY * 0.02) && range <= 3 && recent.length >= PLATEAU_MIN_SESSIONS;

    if (predictedChange >= progressionThreshold) {
      out.push({
        id: `progression-${exercise.id}`,
        kind: 'progression',
        severity: 'positive',
        title: `${exercise.name} is moving up`,
        body: `You've added about ${formatPlusMinus(predictedChange)} on your top set across the last ${recent.length} sessions. Keep the same plan — it's working.`,
        priority: 70 + Math.min(predictedChange, 30), // bigger jumps rank higher
        sparkline: ys,
        metric: { value: formatPlusMinus(predictedChange), label: `last ${recent.length}` },
        tag: exercise.muscleGroup,
      });
    } else if (predictedChange <= regressionThreshold) {
      out.push({
        id: `regression-${exercise.id}`,
        kind: 'regression',
        severity: 'concern',
        title: `${exercise.name} is trending down`,
        body: `Top set has dropped about ${formatPlusMinus(predictedChange)} across the last ${recent.length} sessions. Common causes: under-recovered, sleep, calorie deficit. A deload week often fixes it.`,
        priority: 90,
        sparkline: ys,
        metric: { value: formatPlusMinus(predictedChange), label: `last ${recent.length}` },
        tag: exercise.muscleGroup,
      });
    } else if (isPlateau) {
      out.push({
        id: `plateau-${exercise.id}`,
        kind: 'plateau',
        severity: 'warning',
        title: `${exercise.name} is stuck`,
        body: `You've been at roughly the same top set (${minY}–${maxY}kg) for ${recent.length} sessions. Try one of: (a) add a deload week, (b) drop reps and add weight (e.g. 5×3 instead of 4×8), or (c) swap to a related variation for 4 weeks.`,
        priority: 80,
        sparkline: ys,
        metric: { value: `${minY}–${maxY}kg`, label: `last ${recent.length}` },
        tag: exercise.muscleGroup,
      });
    }
  }

  return out;
}

// ----- Volume balance ------------------------------------------------------

const VOLUME_LOOKBACK_WEEKS = 4;

interface MuscleVolumes { [group: string]: number }

function muscleVolumesOver(ctx: CoachContext, weeks: number): MuscleVolumes {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  const cutoffMs = cutoff.getTime();
  const exerciseById = new Map(ctx.exercises.map((e) => [e.id, e]));
  const totals: MuscleVolumes = {};
  for (const w of ctx.workouts) {
    if (w.type === 'rest') continue;
    if (new Date(w.date).getTime() < cutoffMs) continue;
    for (const ex of w.exercises) {
      const def = exerciseById.get(ex.exerciseId);
      if (!def) continue;
      const group = def.muscleGroup;
      let v = 0;
      for (const s of ex.sets) {
        if (s.completed) v += s.weight * s.reps;
      }
      totals[group] = (totals[group] || 0) + v;
    }
  }
  return totals;
}

export function analyzeVolumeBalance(ctx: CoachContext): Insight[] {
  const totals = muscleVolumesOver(ctx, VOLUME_LOOKBACK_WEEKS);
  const out: Insight[] = [];

  // Antagonist pairs we care about. Each emits a single insight when the
  // ratio is meaningfully imbalanced. We require BOTH sides to have
  // non-trivial volume — a 5:0 ratio against an unworked muscle is
  // handled elsewhere (`analyzeMuscleFrequency`).
  const pairs: Array<{ a: MuscleGroup; b: MuscleGroup; aLabel: string; bLabel: string; healthyRange: [number, number]; tip: string }> = [
    {
      a: 'chest', b: 'back',
      aLabel: 'chest', bLabel: 'back',
      healthyRange: [0.7, 1.3],
      tip: 'A near-1:1 push:pull ratio protects your shoulders long-term. Add a row variation if you\'re chest-heavy, or a press if you\'re back-heavy.',
    },
    {
      a: 'biceps', b: 'triceps',
      aLabel: 'biceps', bLabel: 'triceps',
      healthyRange: [0.5, 1.5],
      tip: 'Triceps are ~2/3 of arm size — slightly more triceps volume than biceps is normal.',
    },
  ];

  for (const p of pairs) {
    const va = totals[p.a] || 0;
    const vb = totals[p.b] || 0;
    if (va < 1000 || vb < 1000) continue; // not enough volume to compare meaningfully
    const ratio = va / vb;
    if (ratio >= p.healthyRange[0] && ratio <= p.healthyRange[1]) continue;
    const dominant = ratio > p.healthyRange[1] ? p.aLabel : p.bLabel;
    const lagging = ratio > p.healthyRange[1] ? p.bLabel : p.aLabel;
    const ratioStr = ratio > 1 ? `${ratio.toFixed(1)}:1` : `1:${(1 / ratio).toFixed(1)}`;
    out.push({
      id: `imbalance-${p.a}-${p.b}`,
      kind: 'volume-imbalance',
      severity: 'warning',
      title: `${dominant.charAt(0).toUpperCase() + dominant.slice(1)} is outpacing ${lagging}`,
      body: `${p.aLabel}:${p.bLabel} ratio over the last ${VOLUME_LOOKBACK_WEEKS} weeks is ${ratioStr}. ${p.tip}`,
      priority: 60,
      metric: { value: ratioStr, label: `${p.aLabel}:${p.bLabel}` },
      tag: lagging,
    });
  }

  return out;
}

// ----- Muscle group frequency ---------------------------------------------

const NEGLECT_DAYS = 12;
const NEGLECT_GROUPS: MuscleGroup[] = ['chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps'];

export function analyzeMuscleFrequency(ctx: CoachContext): Insight[] {
  const exerciseById = new Map(ctx.exercises.map((e) => [e.id, e]));
  const lastHit = new Map<MuscleGroup, string>();
  for (const w of ctx.workouts) {
    if (w.type === 'rest') continue;
    const ds = localISO(new Date(w.date));
    for (const ex of w.exercises) {
      const def = exerciseById.get(ex.exerciseId);
      if (!def) continue;
      const hasCompletedSet = ex.sets.some((s) => s.completed);
      if (!hasCompletedSet) continue;
      const prev = lastHit.get(def.muscleGroup);
      if (!prev || ds > prev) lastHit.set(def.muscleGroup, ds);
    }
  }

  const today = localISO(new Date());
  const out: Insight[] = [];
  for (const group of NEGLECT_GROUPS) {
    const last = lastHit.get(group);
    if (!last) {
      // Never trained this group at all in the local history. Worth flagging
      // only if the user has been training >2 weeks (otherwise everything is
      // "neglected" on day 1). The hasEnoughData gate upstream handles that.
      out.push({
        id: `neglect-${group}`,
        kind: 'muscle-neglected',
        severity: 'warning',
        title: `No ${group} training logged`,
        body: `I don't see any completed ${group} work in your history. If that's accurate, plan a session — neglected groups become injury risks over time.`,
        priority: 55,
        tag: group,
      });
      continue;
    }
    const gap = daysBetween(last, today);
    if (gap >= NEGLECT_DAYS) {
      out.push({
        id: `neglect-${group}`,
        kind: 'muscle-neglected',
        severity: gap >= 21 ? 'concern' : 'warning',
        title: `${gap} days since you trained ${group}`,
        body: `Last ${group} session was on ${last}. Aim for at least one direct ${group} session every 5–7 days to keep gains.`,
        priority: 50 + Math.min(gap, 30),
        metric: { value: `${gap}d`, label: 'since last' },
        tag: group,
      });
    }
  }
  return out;
}

// ----- Session frequency / consistency ------------------------------------

export function analyzeFrequency(ctx: CoachContext): Insight[] {
  const out: Insight[] = [];
  const today = new Date();

  // Sessions per week over last 4 weeks (excluding rest days).
  const weeklyCounts: number[] = [0, 0, 0, 0];
  const weekMs = 7 * 86400000;
  for (const w of ctx.workouts) {
    if (w.type === 'rest') continue;
    const diff = today.getTime() - new Date(w.date).getTime();
    if (diff < 0) continue;
    const wk = Math.floor(diff / weekMs);
    if (wk >= 0 && wk < 4) weeklyCounts[wk]++;
  }
  const recentAvg = (weeklyCounts[0] + weeklyCounts[1] + weeklyCounts[2] + weeklyCounts[3]) / 4;
  const thisWeek = weeklyCounts[0];

  if (recentAvg >= 3 && thisWeek === 0) {
    out.push({
      id: 'frequency-low-thisweek',
      kind: 'frequency-low',
      severity: 'warning',
      title: 'No sessions yet this week',
      body: `You've averaged ${recentAvg.toFixed(1)} sessions per week recently. Don't let this week slip — even one short session keeps the habit alive.`,
      priority: 65,
    });
  } else if (recentAvg >= 4 && thisWeek >= 4) {
    out.push({
      id: 'frequency-strong',
      kind: 'frequency-strong',
      severity: 'positive',
      title: 'Crushing it on consistency',
      body: `${thisWeek} sessions this week against a ${recentAvg.toFixed(1)}/week average. Make sure recovery is keeping up — sleep + protein + a deload every ~6 weeks.`,
      priority: 40,
      metric: { value: `${thisWeek}`, label: 'this week' },
    });
  }

  // Recent deload detection — last week's volume <= 65% of trailing avg
  const weeklyVolumes: number[] = [0, 0, 0, 0];
  for (const w of ctx.workouts) {
    if (w.type === 'rest') continue;
    const diff = today.getTime() - new Date(w.date).getTime();
    if (diff < 0) continue;
    const wk = Math.floor(diff / weekMs);
    if (wk >= 0 && wk < 4) weeklyVolumes[wk] += workoutVolume(w);
  }
  const trailingAvg = (weeklyVolumes[1] + weeklyVolumes[2] + weeklyVolumes[3]) / 3;
  if (trailingAvg > 0 && weeklyVolumes[0] > 0 && weeklyVolumes[0] <= trailingAvg * 0.65) {
    out.push({
      id: 'recent-deload',
      kind: 'recent-deload',
      severity: 'positive',
      title: 'This week has been lighter — good',
      body: `Volume is about ${Math.round((1 - weeklyVolumes[0] / trailingAvg) * 100)}% below your trailing average. If that was intentional (deload), perfect. If not, don't push to "make up" — strength returns faster from rest than from grinding.`,
      priority: 30,
    });
  }

  return out;
}

// ----- Goal pacing ---------------------------------------------------------

export function paceGoals(ctx: CoachContext): Insight[] {
  const out: Insight[] = [];

  // Body weight pacing — if user has logged ≥5 entries spanning ≥2 weeks
  // and there's a clear trend, project toward a ±5kg round target from
  // the latest weight.
  if (ctx.bodyWeights.length >= 5) {
    const sorted = [...ctx.bodyWeights].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const earliest = new Date(sorted[0].date).getTime();
    const latest = new Date(sorted[sorted.length - 1].date).getTime();
    const spanDays = (latest - earliest) / 86400000;
    if (spanDays >= 14) {
      const xs = sorted.map((e) => (new Date(e.date).getTime() - earliest) / 86400000);
      const ys = sorted.map((e) => e.weight);
      const { slope, intercept } = linearRegression(xs, ys);
      const currentWeight = intercept + slope * spanDays;
      // Project 30 days out
      const in30 = currentWeight + slope * 30;
      const dirSlope = slope * 7; // kg/week

      // Only emit if the trend is meaningful (≥0.1 kg/week change)
      if (Math.abs(dirSlope) >= 0.1) {
        const direction = dirSlope > 0 ? 'gaining' : 'losing';
        out.push({
          id: 'goal-pacing-bw',
          kind: 'goal-pacing-bw',
          severity: 'neutral',
          title: `You're ${direction} weight steadily`,
          body: `Trend over the last ${Math.round(spanDays)} days: about ${Math.abs(dirSlope).toFixed(1)} kg/week. At this rate you'll be near ${in30.toFixed(1)} kg in 30 days. Whether that's right depends on your goal — adjust intake if not.`,
          priority: 25,
          metric: { value: `${dirSlope > 0 ? '+' : '−'}${Math.abs(dirSlope).toFixed(1)}kg`, label: '/week' },
        });
      }
    }
  }

  // Per-lift pacing: pick the user's strongest "main" lift with strong
  // progression and project when they hit the next round-number target.
  const exerciseById = new Map(ctx.exercises.map((e) => [e.id, e]));
  const today = new Date();
  const cutoff = new Date(); cutoff.setDate(today.getDate() - 90);

  let bestProjection: { exerciseName: string; current: number; target: number; daysToTarget: number; tag: MuscleGroup } | null = null;
  const liftTrends = new Map<string, { ys: number[]; firstDate: Date; lastDate: Date }>();

  const sorted = ctx.workouts
    .filter((w) => w.type !== 'rest' && new Date(w.date) >= cutoff)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (const w of sorted) {
    for (const ex of w.exercises) {
      const def = exerciseById.get(ex.exerciseId);
      if (!def) continue;
      if (!def.isCompound && def.category !== 'compound') continue;
      const top = topSetWeight(w, ex.exerciseId);
      if (!top) continue;
      let bucket = liftTrends.get(ex.exerciseId);
      if (!bucket) {
        bucket = { ys: [], firstDate: new Date(w.date), lastDate: new Date(w.date) };
        liftTrends.set(ex.exerciseId, bucket);
      }
      bucket.ys.push(top.weight);
      bucket.lastDate = new Date(w.date);
    }
  }

  for (const [exId, bucket] of liftTrends) {
    if (bucket.ys.length < 4) continue;
    const def = exerciseById.get(exId);
    if (!def) continue;
    const xs = bucket.ys.map((_, i) => i);
    const { slope } = linearRegression(xs, bucket.ys);
    if (slope <= 0) continue; // pacing only meaningful when progressing
    const current = bucket.ys[bucket.ys.length - 1];
    // Find the next round-number 2.5 / 5 multiple above current
    const target = Math.ceil((current + 2.5) / 5) * 5;
    if (target <= current) continue;
    // Sessions to target at current pace
    const sessionsToTarget = (target - current) / slope;
    if (!isFinite(sessionsToTarget) || sessionsToTarget <= 0 || sessionsToTarget > 30) continue;
    // Estimate calendar days based on the cadence we've actually seen
    const sessionGapDays = (bucket.lastDate.getTime() - bucket.firstDate.getTime()) / 86400000 / Math.max(1, bucket.ys.length - 1);
    const daysToTarget = Math.round(sessionsToTarget * sessionGapDays);
    if (daysToTarget < 7 || daysToTarget > 180) continue;
    if (!bestProjection || sessionsToTarget < (bestProjection.daysToTarget / sessionGapDays)) {
      bestProjection = { exerciseName: def.name, current, target, daysToTarget, tag: def.muscleGroup };
    }
  }

  if (bestProjection) {
    const eta = new Date();
    eta.setDate(eta.getDate() + bestProjection.daysToTarget);
    out.push({
      id: 'goal-pacing-lift',
      kind: 'goal-pacing-lift',
      severity: 'positive',
      title: `${bestProjection.target}kg ${bestProjection.exerciseName} is in reach`,
      body: `At your current pace (top set at ${bestProjection.current}kg), you should hit ${bestProjection.target}kg around ${eta.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}. Keep stacking sessions.`,
      priority: 35,
      metric: { value: `${bestProjection.target}kg`, label: `~${bestProjection.daysToTarget}d` },
      tag: bestProjection.tag,
    });
  }

  return out;
}

// ----- Next-workout suggestion --------------------------------------------

export function suggestNextWorkout(ctx: CoachContext): Insight[] {
  if (!ctx.activePlan) return [];
  const days = ctx.activePlan.days;
  if (days.length === 0) return [];
  // Find the next non-rest day after the last completed one. If user
  // hasn't completed a day yet, suggest the first non-rest day.
  let startIdx = 0;
  if (ctx.lastUsedDay !== null && ctx.lastUsedDay !== undefined) {
    const lastIdx = days.findIndex((d) => d.dayNumber === ctx.lastUsedDay);
    if (lastIdx >= 0) startIdx = (lastIdx + 1) % days.length;
  }
  for (let offset = 0; offset < days.length; offset++) {
    const idx = (startIdx + offset) % days.length;
    const day = days[idx];
    if (day.isRestDay || day.exercises.length === 0) continue;
    return [{
      id: 'next-workout',
      kind: 'next-workout',
      severity: 'neutral',
      title: 'Up next on your plan',
      body: `${day.name} — ${day.exercises.length} exercise${day.exercises.length === 1 ? '' : 's'}. ${
        day.exercises.slice(0, 3).map((e) => e.exerciseName).join(', ')
      }${day.exercises.length > 3 ? '…' : ''}`,
      priority: 20,
      tag: ctx.activePlan.name,
    }];
  }
  return [];
}

// ----- Recent PR celebration ----------------------------------------------

export function recentPRCelebration(ctx: CoachContext): Insight[] {
  // A "new PR this week" means the user beat their previous best for an
  // exercise within the last 7 days. We compute previous max from
  // workouts BEFORE the cutoff, then look for any set in the recent
  // window that strictly exceeds it. Just matching the all-time max
  // (including this week's data) would falsely fire whenever an old PR
  // is hit again at the same weight × reps.
  const today = new Date();
  const weekAgo = new Date(); weekAgo.setDate(today.getDate() - 7);
  const cutoffMs = weekAgo.getTime();
  const exerciseById = new Map(ctx.exercises.map((e) => [e.id, e]));

  // Previous best (strictly before the cutoff)
  const prevBest = new Map<string, { weight: number; reps: number }>();
  for (const w of ctx.workouts) {
    if (w.type === 'rest') continue;
    if (new Date(w.date).getTime() >= cutoffMs) continue;
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
        const cur = prevBest.get(ex.exerciseId);
        if (!cur || s.weight > cur.weight || (s.weight === cur.weight && s.reps > cur.reps)) {
          prevBest.set(ex.exerciseId, { weight: s.weight, reps: s.reps });
        }
      }
    }
  }

  // Strict PRs in the recent window
  const recentPRs: Array<{ name: string; weight: number; reps: number; muscleGroup: MuscleGroup }> = [];
  const seen = new Set<string>();
  for (const w of ctx.workouts) {
    if (w.type === 'rest') continue;
    if (new Date(w.date).getTime() < cutoffMs) continue;
    for (const ex of w.exercises) {
      if (seen.has(ex.exerciseId)) continue;
      const def = exerciseById.get(ex.exerciseId);
      if (!def) continue;
      if (!def.isCompound && def.category !== 'compound') continue;
      const prev = prevBest.get(ex.exerciseId);
      let prSet: { weight: number; reps: number } | null = null;
      for (const s of ex.sets) {
        if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
        const beats = !prev || s.weight > prev.weight || (s.weight === prev.weight && s.reps > prev.reps);
        if (!beats) continue;
        if (!prSet || s.weight > prSet.weight || (s.weight === prSet.weight && s.reps > prSet.reps)) {
          prSet = { weight: s.weight, reps: s.reps };
        }
      }
      if (prSet) {
        seen.add(ex.exerciseId);
        recentPRs.push({ name: def.name, weight: prSet.weight, reps: prSet.reps, muscleGroup: def.muscleGroup });
      }
    }
  }
  if (recentPRs.length === 0) return [];

  // Take up to 2 — more than that overwhelms the feed.
  const top2 = recentPRs.sort((a, b) => b.weight - a.weight).slice(0, 2);
  return top2.map((pr) => ({
    id: `pr-${pr.name}`,
    kind: 'pr-celebration',
    severity: 'positive',
    title: `New PR on ${pr.name}`,
    body: `${pr.weight}kg × ${pr.reps} this week — beats your previous best. Banked.`,
    priority: 55,
    metric: { value: `${pr.weight}kg`, label: `× ${pr.reps}` },
    tag: pr.muscleGroup,
  }));
}

// ----- Weekly summary ------------------------------------------------------

export function computeWeeklySummary(workouts: Workout[]): WeeklySummary {
  const today = new Date();
  const thisWeekStart = weekStartLocal(today);

  // 8-week sparkline, oldest → newest
  const weeklyVolumes: number[] = new Array(8).fill(0);
  const weekStartCache = new Map<string, number>(); // ISO → bucket index from current week (0 = this week)

  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    const ws = weekStartLocal(new Date(w.date));
    let idx = weekStartCache.get(ws);
    if (idx === undefined) {
      const wsDate = new Date(ws + 'T00:00:00');
      const nowWs = new Date(thisWeekStart + 'T00:00:00');
      idx = Math.round((nowWs.getTime() - wsDate.getTime()) / (7 * 86400000));
      weekStartCache.set(ws, idx);
    }
    if (idx < 0 || idx >= 8) continue;
    weeklyVolumes[7 - idx] += workoutVolume(w);
  }

  const sessions = workouts.filter((w) =>
    w.completed && w.type !== 'rest' && weekStartLocal(new Date(w.date)) === thisWeekStart
  ).length;
  const volume = weeklyVolumes[7];
  const lastWeek = weeklyVolumes[6];
  const volumeDelta = volume - lastWeek;

  // PRs this week — count exercises where THIS week has a set that
  // strictly beats the user's previous best (all sets logged before
  // this week). Just comparing to "all-time max including this week"
  // would treat a same-as-old-PR set as a new PR.
  const prevBest = new Map<string, { weight: number; reps: number }>();
  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    if (weekStartLocal(new Date(w.date)) === thisWeekStart) continue;
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        if (!s.completed || s.weight <= 0 || s.reps <= 0) continue;
        const cur = prevBest.get(ex.exerciseId);
        if (!cur || s.weight > cur.weight || (s.weight === cur.weight && s.reps > cur.reps)) {
          prevBest.set(ex.exerciseId, { weight: s.weight, reps: s.reps });
        }
      }
    }
  }
  let prsThisWeek = 0;
  const counted = new Set<string>();
  for (const w of workouts) {
    if (!w.completed || w.type === 'rest') continue;
    if (weekStartLocal(new Date(w.date)) !== thisWeekStart) continue;
    for (const ex of w.exercises) {
      if (counted.has(ex.exerciseId)) continue;
      const prev = prevBest.get(ex.exerciseId);
      const beat = ex.sets.some((s) =>
        s.completed && s.weight > 0 && s.reps > 0 &&
        (!prev || s.weight > prev.weight || (s.weight === prev.weight && s.reps > prev.reps))
      );
      if (beat) {
        prsThisWeek++;
        counted.add(ex.exerciseId);
      }
    }
  }

  return { sessions, volume, volumeDelta, prsThisWeek, weeklyVolumes };
}

// ----- Extended context (for the LLM) ------------------------------------

/**
 * Rich snapshot of the user's full training state, packaged for the
 * LLM-backed AI Coach. This is everything we want the model to "see"
 * so it can reference real numbers and exercises in its replies
 * instead of giving generic advice.
 *
 * The shape is intentionally compact-but-comprehensive: PRs are
 * compressed to ≤12 most recent entries, workouts to last 10 with a
 * summary line each, and exercise library is summarized as a count by
 * muscle group rather than dumping every entry.
 */
export interface ExtendedCoachContext {
  report: CoachReport;
  personalRecords: PersonalRecord[];
  recentWorkouts: Workout[];
  bodyWeight: {
    current: number | null;
    delta7d: number | null;
    delta30d: number | null;
    samples: number;
  };
  latestMeasurement: BodyMeasurementEntry | null;
  activePlan: WeeklyPlan | null;
  lastUsedDayName: string | null;
  streak: {
    currentWeeks: number;
    longestWeeks: number;
    freezesAvailable: number;
    daysToNextFreeze: number;
  };
  /** Total exercises in the user's library, broken down by muscle group. */
  libraryByMuscleGroup: Partial<Record<MuscleGroup, number>>;
  /** Total all-time non-rest workouts. */
  totalWorkouts: number;
}

export function buildExtendedContext(): ExtendedCoachContext {
  const allWorkouts = storage.getWorkouts();
  const completed = allWorkouts.filter((w) => w.completed);
  const trainingWorkouts = completed.filter((w) => w.type !== 'rest');
  const exercises = storage.getExercises();
  const bodyWeights = storage.getBodyWeightEntries();
  const measurements = storage.getBodyMeasurements();
  const activePlan = storage.getActivePlan();
  const lastUsedDay = storage.getLastUsedDay();

  const ctx: CoachContext = {
    workouts: completed,
    exercises,
    bodyWeights,
    activePlan,
    lastUsedDay,
  };
  const report = buildReportFromContext(ctx);

  // Most recent workouts first, capped to 10.
  const recentWorkouts = [...trainingWorkouts]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10);

  // Top 12 PRs by date desc — keeps prompt compact while showing the
  // most relevant lifts.
  const personalRecords = [...storage.getPersonalRecords()]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 12);

  // Body weight: latest + 7d / 30d delta. Computed over the actual
  // logged samples (not interpolated).
  const sortedBW = [...bodyWeights].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const latestBW = sortedBW[sortedBW.length - 1];
  const findClosestBefore = (daysAgo: number): BodyWeightEntry | undefined => {
    if (!latestBW) return undefined;
    const cutoff = new Date(latestBW.date).getTime() - daysAgo * 86400000;
    let best: BodyWeightEntry | undefined;
    for (const e of sortedBW) {
      if (new Date(e.date).getTime() <= cutoff) best = e;
      else break;
    }
    return best;
  };
  const sevenAgo = findClosestBefore(7);
  const thirtyAgo = findClosestBefore(30);
  const bodyWeight = {
    current: latestBW?.weight ?? null,
    delta7d: latestBW && sevenAgo ? latestBW.weight - sevenAgo.weight : null,
    delta30d: latestBW && thirtyAgo ? latestBW.weight - thirtyAgo.weight : null,
    samples: sortedBW.length,
  };

  const latestMeasurement = measurements.length > 0
    ? [...measurements].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
    : null;

  // Streak: weekly streak + freeze state.
  const streakState = getStreakState();
  const frozenWeeks = new Set(
    streakState.freezeConsumedDates.map((ds) => weekStartISO(new Date(ds + 'T00:00:00')))
  );
  const { current, longest } = computeWeekStreak(completed, frozenWeeks);
  const streak = {
    currentWeeks: current,
    longestWeeks: longest,
    freezesAvailable: streakState.freezes,
    daysToNextFreeze: daysUntilNextFreeze(streakState),
  };
  // Touch MAX_FREEZES so the linter doesn't complain about the unused
  // import; it's there for readers who want to know the cap.
  void MAX_FREEZES;

  // Library breakdown by muscle group.
  const libraryByMuscleGroup: Partial<Record<MuscleGroup, number>> = {};
  for (const e of exercises) {
    libraryByMuscleGroup[e.muscleGroup] = (libraryByMuscleGroup[e.muscleGroup] || 0) + 1;
  }

  // Last-used day name from the active plan.
  let lastUsedDayName: string | null = null;
  if (activePlan && lastUsedDay !== null && lastUsedDay !== undefined) {
    const day = activePlan.days.find((d) => d.dayNumber === lastUsedDay);
    if (day) lastUsedDayName = day.name;
  }

  return {
    report,
    personalRecords,
    recentWorkouts,
    bodyWeight,
    latestMeasurement,
    activePlan,
    lastUsedDayName,
    streak,
    libraryByMuscleGroup,
    totalWorkouts: trainingWorkouts.length,
  };
}
