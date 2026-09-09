// Bulk / cut phase engine — docs/HEALTH_SPEC.md §5.
//
// Pure functions only: no storage, no Firestore, no React. Every input is
// passed in (body-weight entries, nutrition days, a fallback maintenance
// number), so the whole file is unit-testable and safe to call from a view
// on every render.

import type { BodyWeightEntry, NutritionDay, PhaseGoal, PhaseSettings } from '../types';
import type { MaintenanceBasis } from '../health/targets';

const HALF_LIFE_DAYS = 7;
const KCAL_PER_KG = 7700;
const MS_PER_DAY = 86_400_000;

/** ±%/week band that still counts as maintaining. */
export const MAINTAIN_BAND_PCT = 0.25;
/** A trend needs at least this many weigh-ins spanning at least this many days. */
export const MIN_TREND_POINTS = 4;
export const MIN_TREND_SPAN_DAYS = 7;
/** Below this |%/week| a cut or bulk counts as stalled. */
const STALL_PCT_PER_WEEK = 0.1;
const STALL_MIN_WEEKS = 3;
const SLOW_MIN_WEEKS = 2;
/** Logged nutrition days needed before intake replaces the formula. */
const ADAPTIVE_MIN_LOGGED_DAYS = 10;

const DEFAULT_TARGET_PCT: Record<PhaseGoal, number> = { cut: 0.5, bulk: 0.25, maintain: 0 };

// ---------- local date helpers (no dependency on health/store) ----------

function isoDate(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function midnight(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
/** Whole days from `b` to `a` (DST-safe: both ends are local midnight). */
function dayDiff(a: string, b: string): number {
  return Math.round((midnight(a) - midnight(b)) / MS_PER_DAY);
}
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}

// ---------- weight trend ----------

export interface TrendPoint {
  date: string;
  /** Mean of that day's weigh-ins, kg. */
  weight: number;
  /** Exponential moving average, 7-day half-life. */
  ema: number;
}

export interface WeightTrend {
  status: 'ok' | 'insufficient';
  /** Oldest first, one per logged day inside the window. */
  points: TrendPoint[];
  ratePctPerWeek: number;
  rateKgPerWeek: number;
  latestEma: number | null;
  startEma: number | null;
}

/** Least-squares slope of `values` against `days`, per day. */
function slopePerDay(days: number[], values: number[]): number {
  const n = days.length;
  const meanX = days.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = days[i] - meanX;
    num += dx * (values[i] - meanY);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Smoothed weight trend over the last `days` days (window includes today).
 *
 * Several weigh-ins on one day are averaged first, then an EMA with a 7-day
 * half-life runs over *every* logged day up to `now`, not just the window —
 * the burn-in means `latestEma` is a settled read of today's weight rather
 * than an artefact of where the window happens to start. The EMA lags a
 * moving weight by roughly 10 days of trend, so the weekly rate is the
 * least-squares slope through the raw daily weights instead: unbiased with
 * gaps, sparse weigh-ins or a short history, and still noise-resistant.
 */
export function weightTrend(
  entries: BodyWeightEntry[],
  options: { days?: number; now?: Date } = {},
): WeightTrend {
  const { days = 14, now = new Date() } = options;
  const today = isoDate(now);
  const from = addDays(today, -(days - 1));

  const byDay = new Map<string, { sum: number; count: number }>();
  for (const e of entries) {
    const date = e.date.slice(0, 10);
    if (!(e.weight > 0) || date > today) continue;
    const cur = byDay.get(date);
    if (cur) { cur.sum += e.weight; cur.count += 1; } else byDay.set(date, { sum: e.weight, count: 1 });
  }
  const daily = [...byDay.entries()]
    .map(([date, v]) => ({ date, weight: v.sum / v.count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const points: TrendPoint[] = [];
  let ema = 0;
  for (let i = 0; i < daily.length; i++) {
    const day = daily[i];
    if (i === 0) {
      ema = day.weight;
    } else {
      const alpha = 1 - Math.pow(0.5, dayDiff(day.date, daily[i - 1].date) / HALF_LIFE_DAYS);
      ema += alpha * (day.weight - ema);
    }
    if (day.date >= from) points.push({ date: day.date, weight: day.weight, ema });
  }

  const startEma = points.length ? points[0].ema : null;
  const latestEma = points.length ? points[points.length - 1].ema : null;
  const spanDays = points.length ? dayDiff(points[points.length - 1].date, points[0].date) : 0;
  const ok = points.length >= MIN_TREND_POINTS && spanDays >= MIN_TREND_SPAN_DAYS;

  const rateKgPerWeek = ok
    ? slopePerDay(points.map((p) => dayDiff(p.date, points[0].date)), points.map((p) => p.weight)) * 7
    : 0;
  const ratePctPerWeek = ok && latestEma ? (rateKgPerWeek / latestEma) * 100 : 0;

  return { status: ok ? 'ok' : 'insufficient', points, ratePctPerWeek, rateKgPerWeek, latestEma, startEma };
}

/** What the scale says you are actually doing, regardless of what you planned. */
export function classifyPhase(ratePctPerWeek: number): PhaseGoal {
  if (ratePctPerWeek > MAINTAIN_BAND_PCT) return 'bulk';
  if (ratePctPerWeek < -MAINTAIN_BAND_PCT) return 'cut';
  return 'maintain';
}

// ---------- maintenance ----------

export interface MaintenanceEstimate {
  kcal: number | null;
  /** `adaptive` = from real intake + trend, `formula` = Mifflin–St Jeor × activity. */
  basis: MaintenanceBasis;
  loggedDays: number;
}

function dayKcal(day: NutritionDay): number {
  return day.entries.reduce((sum, e) => sum + e.macros.kcal, 0);
}

/**
 * Maintenance from what actually happened: average intake over the logged
 * days minus the energy the weight change accounts for. Needs ≥ 10 logged
 * days in the same window as `trend`; otherwise falls back to the formula
 * number (which is itself null when the profile is incomplete).
 */
export function adaptiveMaintenance(input: {
  nutritionDays: NutritionDay[];
  trend: WeightTrend;
  fallbackKcal: number | null;
}): MaintenanceEstimate {
  const { nutritionDays, trend, fallbackKcal } = input;
  const logged = nutritionDays.map(dayKcal).filter((kcal) => kcal > 0);

  if (logged.length >= ADAPTIVE_MIN_LOGGED_DAYS && trend.status === 'ok') {
    const avgIntake = logged.reduce((a, b) => a + b, 0) / logged.length;
    return {
      kcal: Math.round(avgIntake - (trend.rateKgPerWeek * KCAL_PER_KG) / 7),
      basis: 'adaptive',
      loggedDays: logged.length,
    };
  }
  if (fallbackKcal !== null) return { kcal: Math.round(fallbackKcal), basis: 'formula', loggedDays: logged.length };
  return { kcal: null, basis: 'none', loggedDays: logged.length };
}

// ---------- goal evaluation ----------

export type GoalStatus = 'on-track' | 'too-fast' | 'too-slow' | 'stalled' | 'insufficient';

export interface GoalEvaluation {
  status: GoalStatus;
  /** One short sentence: what the scale is doing. */
  headline: string;
  /** One short sentence: what to do about it. */
  guidance: string;
  /** Daily kcal change to apply, signed. 0 when on track. */
  suggestedKcalDelta: number;
}

/** Whole weeks (fractional) since the phase started; never negative. */
export function weeksElapsed(settings: PhaseSettings, now: Date = new Date()): number {
  return Math.max(0, dayDiff(isoDate(now), settings.startDate) / 7);
}

function rateSentence(trend: WeightTrend): string {
  const verb = trend.rateKgPerWeek < 0 ? 'Losing' : 'Gaining';
  return `${verb} ${Math.abs(trend.rateKgPerWeek).toFixed(2)} kg a week (${Math.abs(trend.ratePctPerWeek).toFixed(2)} %)`;
}
function targetSentence(target: number): string {
  return `${target > 0 ? '+' : '−'}${Math.abs(target).toFixed(2)} %/week`;
}
function kcalPhrase(delta: number): string {
  return `${delta > 0 ? 'Add' : 'Cut'} about ${Math.abs(delta)} kcal a day`;
}

function insufficientEvaluation(trend: WeightTrend): GoalEvaluation {
  const missing = MIN_TREND_POINTS - trend.points.length;
  const guidance = missing > 0
    ? `Log ${missing} more weigh-in${missing === 1 ? '' : 's'} over the next week — ${MIN_TREND_POINTS} across ${MIN_TREND_SPAN_DAYS} days is enough to read a trend.`
    : `Your weigh-ins cover less than ${MIN_TREND_SPAN_DAYS} days. Keep logging for a few more mornings.`;
  return { status: 'insufficient', headline: 'Not enough weigh-ins yet', guidance, suggestedKcalDelta: 0 };
}

/**
 * Compares the measured trend with the phase the user asked for.
 * `weeks` is `weeksElapsed(settings)` — passed in so the caller controls
 * "now" (and tests do not have to mock the clock twice).
 */
export function evaluateGoal(settings: PhaseSettings, trend: WeightTrend, weeks: number): GoalEvaluation {
  if (trend.status !== 'ok') return insufficientEvaluation(trend);

  const rate = trend.ratePctPerWeek;
  const target = Math.abs(settings.targetRatePctPerWeek) || DEFAULT_TARGET_PCT[settings.goal];

  if (settings.goal === 'maintain' || target === 0) {
    if (Math.abs(rate) <= MAINTAIN_BAND_PCT) {
      return {
        status: 'on-track',
        headline: `Holding steady${trend.latestEma ? ` at ${trend.latestEma.toFixed(1)} kg` : ''}`,
        guidance: `You are inside ±${MAINTAIN_BAND_PCT} %/week. Keep intake where it is.`,
        suggestedKcalDelta: 0,
      };
    }
    const delta = rate > 0 ? -150 : 150;
    return {
      status: 'too-fast',
      headline: `${rateSentence(trend)} while maintaining`,
      guidance: `${kcalPhrase(delta)} and re-check in two weeks.`,
      suggestedKcalDelta: delta,
    };
  }

  // Progress in the direction the user asked for: positive = going the right way.
  const direction = settings.goal === 'cut' ? -1 : 1;
  const progress = rate * direction;
  const targetText = targetSentence(target * direction);

  if (Math.abs(rate) < STALL_PCT_PER_WEEK && weeks >= STALL_MIN_WEEKS) {
    const delta = direction === -1 ? -200 : 200;
    return {
      status: 'stalled',
      headline: `Stalled — the trend is flat${trend.latestEma ? ` at ${trend.latestEma.toFixed(1)} kg` : ''}`,
      guidance: `${Math.floor(weeks)} weeks into this ${settings.goal}. ${kcalPhrase(delta)}${direction === -1 ? ' (or add steps)' : ''} and re-check in a week.`,
      suggestedKcalDelta: delta,
    };
  }

  const fastMultiple = settings.goal === 'cut' ? 1.5 : 2;
  if (progress > fastMultiple * target) {
    const severe = progress > (settings.goal === 'cut' ? 2 : 3) * target;
    const delta = (severe ? 200 : 150) * -direction;
    return {
      status: 'too-fast',
      headline: `${rateSentence(trend)} — faster than ${targetText}`,
      guidance: settings.goal === 'cut'
        ? `Losing this fast costs muscle. ${kcalPhrase(delta)} and re-check in a week.`
        : `Most of this is fat at that speed. ${kcalPhrase(delta)} and re-check in a week.`,
      suggestedKcalDelta: delta,
    };
  }

  if (progress < 0.5 * target) {
    if (weeks < SLOW_MIN_WEEKS) {
      return {
        status: 'on-track',
        headline: `${rateSentence(trend)} — ${weeks < 1 ? 'first week' : 'week two'} of the phase`,
        guidance: 'Too early to judge. Hold intake steady and let the trend settle.',
        suggestedKcalDelta: 0,
      };
    }
    const delta = (progress < 0.25 * target ? 200 : 150) * direction;
    return {
      status: 'too-slow',
      headline: `${rateSentence(trend)} — slower than ${targetText}`,
      guidance: `${Math.floor(weeks)} weeks in and the trend is behind plan. ${kcalPhrase(delta)} and re-check in a week.`,
      suggestedKcalDelta: delta,
    };
  }

  return {
    status: 'on-track',
    headline: `${rateSentence(trend)} — on track`,
    guidance: `That is in range for ${targetText}. Keep intake where it is.`,
    suggestedKcalDelta: 0,
  };
}

/**
 * The weight the plan says you should be on each of `dates`, given where the
 * phase started and the rate it asks for. Compounding, because the rate is a
 * percentage of current body weight, not a fixed number of kilos.
 *
 * Returns null for any date before the phase began — there is no plan to
 * compare against yet, and a flat line back to the start would imply one.
 */
export function plannedWeights(
  settings: PhaseSettings,
  dates: readonly string[],
  startWeightKg: number,
): Array<number | null> {
  const start = new Date(`${settings.startDate}T00:00:00`).getTime();
  const weeklyFactor = 1 + settings.targetRatePctPerWeek / 100;
  return dates.map((date) => {
    const t = new Date(`${date.slice(0, 10)}T00:00:00`).getTime();
    if (!Number.isFinite(t) || t < start) return null;
    const weeks = (t - start) / (7 * 86_400_000);
    return Math.round(startWeightKg * weeklyFactor ** weeks * 100) / 100;
  });
}

/**
 * How far the scale has drifted from the plan, in kg, right now. Positive
 * means heavier than planned. Null until the phase has a start weight and at
 * least one reading after it began.
 */
export function planDrift(
  settings: PhaseSettings,
  latestDate: string,
  latestWeightKg: number,
  startWeightKg: number,
): number | null {
  const [planned] = plannedWeights(settings, [latestDate], startWeightKg);
  if (planned === null) return null;
  return Math.round((latestWeightKg - planned) * 10) / 10;
}
