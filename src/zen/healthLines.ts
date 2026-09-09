import type { DayEnergy } from '../energy';
import type { ActivityDay, BodyWeightEntry, NutritionDay, NutritionTargets, PhaseSettings } from '../types';
import { fmtDate, fmtDay, num, signed } from './format';

/**
 * Nutrition / activity / phase text for Zen (docs/HEALTH_SPEC.md §6) —
 * the context-pack lines and the `nutrition_range` / `activity_range` /
 * `phase_detail` answers.
 *
 * Pure: everything comes in as arguments, so `contextPack.ts` and
 * `dataRequests.ts` own the reads (`src/health/store.ts`, which pulls in
 * Firebase) and this stays unit-testable.
 */

interface DayTotals { kcal: number; protein: number; carbs: number; fat: number }

/** Local total for a day. `sumMacros` in the health store does the same,
 *  but importing it would drag Firebase into this module's tests. */
function dayTotals(day: NutritionDay): DayTotals {
  let kcal = 0, protein = 0, carbs = 0, fat = 0;
  for (const e of day.entries) {
    kcal += e.macros.kcal;
    protein += e.macros.protein;
    carbs += e.macros.carbs;
    fat += e.macros.fat;
  }
  return { kcal, protein, carbs, fat };
}

function isLogged(day: NutritionDay): boolean {
  return day.entries.length > 0;
}

function macroStr(t: DayTotals): string {
  return `P${Math.round(t.protein)} C${Math.round(t.carbs)} F${Math.round(t.fat)}`;
}

export interface NutritionContextInput {
  today: NutritionDay;
  /** The 7 days ending today. Days with no entries may be present or absent. */
  week: NutritionDay[];
  targets: NutritionTargets | null;
}

/** "Nutrition today: …" + "Nutrition 7d: …" — two short lines, or none when nothing is logged. */
export function nutritionContextLines(input: NutritionContextInput): string[] {
  const lines: string[] = [];
  const logged = input.week.filter(isLogged);
  const t = input.targets;

  const today = dayTotals(input.today);
  if (isLogged(input.today)) {
    const vs = t ? ` vs target ${t.kcal} kcal, P${t.protein} C${t.carbs} F${t.fat}` : '';
    lines.push(`Nutrition today: ${Math.round(today.kcal)} kcal, ${macroStr(today)} g${vs}.`);
  } else if (t) {
    lines.push(`Nutrition today: nothing logged yet (target ${t.kcal} kcal, P${t.protein} C${t.carbs} F${t.fat}).`);
  }

  if (logged.length > 0) {
    const sum = logged.reduce<DayTotals>(
      (acc, d) => { const x = dayTotals(d); return { kcal: acc.kcal + x.kcal, protein: acc.protein + x.protein, carbs: acc.carbs + x.carbs, fat: acc.fat + x.fat }; },
      { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    );
    const avg: DayTotals = { kcal: sum.kcal / logged.length, protein: sum.protein / logged.length, carbs: sum.carbs / logged.length, fat: sum.fat / logged.length };
    lines.push(`Nutrition 7d: avg ${Math.round(avg.kcal)} kcal, ${macroStr(avg)} g on ${logged.length} of 7 logged days.`);
  }
  return lines;
}

function avgOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** "Activity 7d: avg 8200 steps, 6.8 h sleep…" — or null when nothing was recorded. */
export function activityContextLine(days: ActivityDay[]): string | null {
  const steps = avgOf(days.map((d) => d.steps).filter((n): n is number => typeof n === 'number'));
  const active = avgOf(days.map((d) => d.activeKcal).filter((n): n is number => typeof n === 'number'));
  const sleep = avgOf(days.map((d) => d.sleepMin).filter((n): n is number => typeof n === 'number'));
  const rhr = avgOf(days.map((d) => d.restingHr).filter((n): n is number => typeof n === 'number'));
  const parts: string[] = [];
  if (steps !== null) parts.push(`${Math.round(steps)} steps`);
  if (active !== null) parts.push(`${Math.round(active)} active kcal`);
  if (sleep !== null) parts.push(`${num(sleep / 60, 1)} h sleep`);
  if (rhr !== null) parts.push(`resting HR ${Math.round(rhr)}`);
  if (parts.length === 0) return null;
  return `Activity 7d: avg ${parts.join(', ')} over ${days.length} recorded day${days.length === 1 ? '' : 's'}.`;
}

export interface WeightTrend {
  kgPerWeek: number;
  pctPerWeek: number;
  /** Days between the first and last sample used. */
  days: number;
  samples: number;
}

/**
 * Weekly rate of body-weight change over the trailing `windowDays`, from
 * the first and last samples (≥ 3 samples spanning ≥ 7 days). Deliberately
 * simple — `src/phase/engine.ts` (H2) owns the EMA version and supersedes
 * this once it lands.
 */
export function weightTrend(entries: BodyWeightEntry[], now: Date = new Date(), windowDays = 21): WeightTrend | null {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const rows = entries
    .filter((e) => { const t = new Date(e.date).getTime(); return Number.isFinite(t) && t >= cutoff && e.weight > 0; })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (rows.length < 3) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const days = (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000;
  if (days < 7) return null;
  const kgPerWeek = ((last.weight - first.weight) / days) * 7;
  const avgWeight = (first.weight + last.weight) / 2;
  return { kgPerWeek, pctPerWeek: (kgPerWeek / avgWeight) * 100, days: Math.round(days), samples: rows.length };
}

/** on track / too fast / stalled, against the phase's target rate (HEALTH_SPEC §5 thresholds). */
export function phaseStatus(phase: PhaseSettings, trend: WeightTrend): 'on track' | 'too fast' | 'stalled' {
  const actual = trend.pctPerWeek;
  const target = phase.targetRatePctPerWeek;
  if (phase.goal === 'maintain') return Math.abs(actual) > 0.35 ? 'too fast' : 'on track';
  if (Math.abs(actual) < 0.1 || Math.sign(actual) !== Math.sign(target)) return 'stalled';
  const limit = Math.abs(target) * (phase.goal === 'cut' ? 1.5 : 2);
  return Math.abs(actual) > limit ? 'too fast' : 'on track';
}

/** "Phase: cut, target −0.5 %/week since 12 Aug 2026; actual −0.42 %/week (on track)." */
export function phaseContextLine(phase: PhaseSettings | null, trend: WeightTrend | null): string | null {
  if (!phase) {
    if (!trend) return null;
    return `Body weight trend: ${signed(trend.kgPerWeek, 2)} kg/week (${signed(trend.pctPerWeek, 2)} %/week over ${trend.days}d, no phase set).`;
  }
  const head = `Phase: ${phase.goal}, target ${signed(phase.targetRatePctPerWeek, 2)} %/week since ${fmtDate(phase.startDate)}`;
  if (!trend) return `${head}; not enough weigh-ins yet to measure the actual rate.`;
  return `${head}; actual ${signed(trend.pctPerWeek, 2)} %/week (${signed(trend.kgPerWeek, 2)} kg/week over ${trend.days}d) — ${phaseStatus(phase, trend)}.`;
}

// ----- data-request answers ----------------------------------------------

/** Day-by-day kcal and macros for `nutrition_range`. */
export function formatNutritionRange(days: NutritionDay[], from: string, to: string, targets: NutritionTargets | null): string {
  const logged = days.filter(isLogged);
  if (logged.length === 0) return `No food logged between ${from} and ${to}.`;
  const lines = logged.map((d) => {
    const t = dayTotals(d);
    const water = d.waterMl > 0 ? ` · ${num(d.waterMl / 1000, 1)} L water` : '';
    return `${fmtDay(d.date + 'T12:00:00')}: ${Math.round(t.kcal)} kcal · ${macroStr(t)} g · ${d.entries.length} item${d.entries.length === 1 ? '' : 's'}${water}`;
  });
  const sum = logged.reduce<DayTotals>(
    (acc, d) => { const x = dayTotals(d); return { kcal: acc.kcal + x.kcal, protein: acc.protein + x.protein, carbs: acc.carbs + x.carbs, fat: acc.fat + x.fat }; },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const n = logged.length;
  const avg = `Average over ${n} logged day${n === 1 ? '' : 's'}: ${Math.round(sum.kcal / n)} kcal · ${macroStr({ kcal: 0, protein: sum.protein / n, carbs: sum.carbs / n, fat: sum.fat / n })} g.`;
  const target = targets ? ` Targets: ${targets.kcal} kcal · P${targets.protein} C${targets.carbs} F${targets.fat} g.` : '';
  return `Nutrition ${from} to ${to} (values from curated dishes and scans are approximate):\n${lines.join('\n')}\n${avg}${target}`;
}

/** Day-by-day steps / sleep / kcal for `activity_range`. */
export function formatActivityRange(days: ActivityDay[], from: string, to: string): string {
  if (days.length === 0) return `No activity recorded between ${from} and ${to}.`;
  const lines = days.map((d) => {
    const parts: string[] = [];
    if (d.steps !== undefined) parts.push(`${d.steps} steps`);
    if (d.activeKcal !== undefined) parts.push(`${Math.round(d.activeKcal)} active kcal`);
    if (d.sleepMin !== undefined) parts.push(`${num(d.sleepMin / 60, 1)} h sleep`);
    if (d.restingHr !== undefined) parts.push(`RHR ${Math.round(d.restingHr)}`);
    if (d.sessions && d.sessions.length > 0) parts.push(`${d.sessions.length} session${d.sessions.length === 1 ? '' : 's'}`);
    return `${fmtDay(d.date + 'T12:00:00')}: ${parts.join(' · ') || 'nothing recorded'} (${d.source})`;
  });
  const summary = activityContextLine(days);
  return `Activity ${from} to ${to}:\n${lines.join('\n')}${summary ? `\n${summary}` : ''}`;
}

export interface PhaseDetailInput {
  phase: PhaseSettings | null;
  targets: NutritionTargets | null;
  weights: BodyWeightEntry[];
  /** Nutrition days in the trend window, for "is the intake actually being logged?". */
  nutritionDays: NutritionDay[];
  now?: Date;
}

/** The full picture behind the phase line, for `phase_detail`. */
export function formatPhaseDetail(input: PhaseDetailInput): string {
  const now = input.now ?? new Date();
  const trend = weightTrend(input.weights, now);
  const lines: string[] = [];

  if (input.phase) {
    const p = input.phase;
    lines.push(`Goal: ${p.goal}, target ${signed(p.targetRatePctPerWeek, 2)} %/week, started ${fmtDate(p.startDate)}${p.startWeightKg ? ` at ${num(p.startWeightKg, 1)}kg` : ''}.`);
  } else {
    lines.push('No bulk/cut phase set — treating this as maintenance.');
  }

  if (trend) {
    lines.push(`Trend: ${signed(trend.kgPerWeek, 2)} kg/week (${signed(trend.pctPerWeek, 2)} %/week) from ${trend.samples} weigh-ins over ${trend.days} days.`);
    if (input.phase) lines.push(`Status: ${phaseStatus(input.phase, trend)}.`);
  } else {
    lines.push('Trend: not enough weigh-ins (need 3+ spanning a week) to measure a rate.');
  }

  const recent = [...input.weights]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10)
    .reverse();
  if (recent.length > 0) {
    lines.push(`Weigh-ins: ${recent.map((e) => `${fmtDate(e.date)} ${num(e.weight, 1)}kg`).join('; ')}.`);
  }

  const logged = input.nutritionDays.filter(isLogged);
  if (logged.length > 0) {
    const avgKcal = logged.reduce((a, d) => a + dayTotals(d).kcal, 0) / logged.length;
    lines.push(`Intake: ${Math.round(avgKcal)} kcal/day average across ${logged.length} logged day${logged.length === 1 ? '' : 's'} in that window.`);
  } else {
    lines.push('Intake: no food logged in that window, so the rate cannot be tied to calories yet.');
  }

  if (input.targets) {
    const t = input.targets;
    lines.push(`Targets (${t.mode}): ${t.kcal} kcal, P${t.protein} C${t.carbs} F${t.fat} g, water ${num(t.waterMl / 1000, 1)} L.`);
  } else {
    lines.push('Targets: none set yet.');
  }

  return lines.join('\n');
}

// ----- energy ledger (src/energy.ts) -----------------------------------

/** "Energy today: 2,510 kcal out (1,680 resting + 340 training + 490 moving),
 *   2,180 in, −330 balance." Null when the profile can't give us a BMR. */
export function energyContextLine(day: DayEnergy): string | null {
  if (day.totalKcal == null) return null;
  const parts = [`${Math.round(day.restingKcal ?? 0)} resting`];
  if (day.workoutKcal > 0) parts.push(`${Math.round(day.workoutKcal)} training`);
  const other = day.activeSource === 'device'
    ? Math.max(0, day.activeKcal - day.workoutKcal)
    : day.stepsKcal;
  if (other > 0) parts.push(`${Math.round(other)} moving`);
  const intake = day.intakeKcal > 0
    ? `, ${Math.round(day.intakeKcal)} in, ${signed(day.balanceKcal ?? 0, 0)} balance`
    : ', nothing logged to eat yet';
  return `Energy today: ${Math.round(day.totalKcal)} kcal out (${parts.join(' + ')})${intake}.`;
}

/** One line per day for `energy_range`, plus how the active side was measured. */
export function formatEnergyRange(days: DayEnergy[]): string {
  const usable = days.filter((d) => d.totalKcal != null);
  if (usable.length === 0) {
    return 'No energy figures: the health profile needs height, age and sex, plus a recent weigh-in.';
  }
  const rows = usable.map((d) => {
    const bits = [
      `out ${Math.round(d.totalKcal!)}`,
      `rest ${Math.round(d.restingKcal ?? 0)}`,
      d.workoutKcal > 0 ? `train ${Math.round(d.workoutKcal)}` : null,
      d.stepsKcal > 0 ? `steps ${Math.round(d.stepsKcal)}` : null,
      d.deviceActiveKcal != null ? `device ${Math.round(d.deviceActiveKcal)}` : null,
      d.intakeKcal > 0 ? `in ${Math.round(d.intakeKcal)}` : 'in unlogged',
      d.intakeKcal > 0 && d.balanceKcal != null ? `bal ${signed(d.balanceKcal, 0)}` : null,
    ].filter(Boolean);
    return `${fmtDay(d.date)}: ${bits.join(', ')}`;
  });
  const logged = usable.filter((d) => d.intakeKcal > 0);
  const avgOut = usable.reduce((a, d) => a + (d.totalKcal ?? 0), 0) / usable.length;
  const summary = logged.length
    ? `Average: ${Math.round(avgOut)} kcal out, ${Math.round(logged.reduce((a, d) => a + d.intakeKcal, 0) / logged.length)} kcal in on ${logged.length} logged day${logged.length === 1 ? '' : 's'}.`
    : `Average: ${Math.round(avgOut)} kcal out. No food logged in this window.`;
  return `${rows.join('\n')}\n${summary}\nActive calories are the larger of what the phone measured and what we estimate from steps and sets, so they are never double counted.`;
}
