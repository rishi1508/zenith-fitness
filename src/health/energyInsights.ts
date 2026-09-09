/**
 * Plain-language guidance from the energy ledger.
 *
 * The point is not another dashboard: it is telling someone the one thing they
 * could change today, with the number attached — "eat 300 kcal more" or "add
 * 4,000 steps" — because that is the difference between a tracker and a coach.
 *
 * Pure module. Tested in `tests/energyInsights.test.ts`.
 */
import type { DayEnergy } from '../energy';
import type { NutritionTargets, PhaseGoal, PhaseSettings } from '../types';

export type InsightTone = 'good' | 'warn' | 'info';

export interface EnergyInsight {
  id: string;
  tone: InsightTone;
  /** One short sentence, the finding. */
  headline: string;
  /** One or two sentences with the numbers and what to do. */
  detail: string;
}

/** kcal in a kilo of body mass — the usual planning constant. */
const KCAL_PER_KG = 7700;
/** Steps someone would need to walk off 100 kcal, near enough for advice. */
const KCAL_PER_1000_STEPS = 30;

const round50 = (n: number) => Math.round(n / 50) * 50;
const round500 = (n: number) => Math.round(n / 500) * 500;

/** Daily calorie balance the phase goal implies. Negative for a cut. */
export function targetDailyBalance(phase: PhaseSettings | null, weightKg: number): number {
  if (!phase || !weightKg) return 0;
  const weeklyKg = (phase.targetRatePctPerWeek / 100) * weightKg;
  return Math.round((weeklyKg * KCAL_PER_KG) / 7);
}

const GOAL_WORD: Record<PhaseGoal, string> = { cut: 'cut', bulk: 'bulk', maintain: 'maintenance' };

export function buildEnergyInsights(input: {
  days: DayEnergy[];
  phase: PhaseSettings | null;
  /** Accepted so callers can pass what they already have; the protein advice
   *  uses `proteinTargetG`, which the caller reads off it. */
  targets?: NutritionTargets | null;
  weightKg: number;
  proteinTargetG?: number;
  avgProteinG?: number;
}): EnergyInsight[] {
  const { days, phase, weightKg, proteinTargetG, avgProteinG } = input;
  const out: EnergyInsight[] = [];
  if (days.length === 0) return out;

  const logged = days.filter((d) => d.intakeKcal > 0);
  const measured = logged.filter((d) => d.totalKcal != null);

  // 0. Nothing to say without food logs.
  if (logged.length === 0) {
    out.push({
      id: 'no-intake',
      tone: 'info',
      headline: 'Log a few days of food and this turns into real advice.',
      detail: 'Your calories out are already being tracked from workouts and steps. Once the diary has three or four days, you will see whether you are eating for your goal.',
    });
    return out;
  }

  if (measured.length === 0) {
    out.push({
      id: 'no-profile',
      tone: 'info',
      headline: 'Add your height, age and sex to see calories out.',
      detail: 'Without them the resting burn cannot be estimated, so the balance below is incomplete. It takes ten seconds in Targets → Profile.',
    });
    return out;
  }

  const avgIntake = Math.round(measured.reduce((t, d) => t + d.intakeKcal, 0) / measured.length);
  const avgOut = Math.round(measured.reduce((t, d) => t + (d.totalKcal ?? 0), 0) / measured.length);
  const avgBalance = avgIntake - avgOut;
  const goalBalance = targetDailyBalance(phase, weightKg);
  const goal: PhaseGoal = phase?.goal ?? 'maintain';
  const drift = avgBalance - goalBalance;

  // 1. Are they eating for the goal they picked?
  const tolerance = goal === 'maintain' ? 200 : 150;
  if (Math.abs(drift) <= tolerance) {
    out.push({
      id: 'on-track',
      tone: 'good',
      headline: `You are eating for your ${GOAL_WORD[goal]}.`,
      detail: `Over ${measured.length} logged day${measured.length === 1 ? '' : 's'} you averaged ${avgIntake} kcal in against ${avgOut} out — a ${avgBalance >= 0 ? 'surplus' : 'deficit'} of ${Math.abs(avgBalance)} kcal a day, which is where a ${GOAL_WORD[goal]} should sit. Keep going.`,
    });
  } else if (drift > 0) {
    const extraSteps = round500((drift / KCAL_PER_1000_STEPS) * 1000);
    // Telling someone to walk 15,000 extra steps is not advice. Past what a
    // day can absorb, suggest splitting the gap between plate and pavement.
    const fix = extraSteps <= 8000
      ? `Either eat ${round50(drift)} kcal less or add roughly ${extraSteps.toLocaleString('en-IN')} steps a day.`
      : `Eat ${round50(drift)} kcal less, or split it: ${round50(drift / 2)} kcal less plus about ${round500((drift / 2 / KCAL_PER_1000_STEPS) * 1000).toLocaleString('en-IN')} steps a day.`;
    out.push({
      id: 'over-goal',
      tone: 'warn',
      headline: goal === 'cut'
        ? `You are eating about ${round50(drift)} kcal a day more than your cut needs.`
        : `You are ${round50(drift)} kcal a day above where you aimed.`,
      detail: `Average ${avgIntake} kcal in, ${avgOut} out. At this rate you would ${avgBalance > 0 ? 'gain' : 'lose'} about ${Math.abs((avgBalance * 7) / KCAL_PER_KG).toFixed(2)} kg a week instead of ${Math.abs((goalBalance * 7) / KCAL_PER_KG).toFixed(2)}. ${fix}`,
    });
  } else {
    const shortfall = round50(-drift);
    out.push({
      id: 'under-goal',
      tone: goal === 'bulk' ? 'warn' : 'info',
      headline: goal === 'bulk'
        ? `You are ${shortfall} kcal a day short of your bulk.`
        : `You are eating ${shortfall} kcal a day less than your ${GOAL_WORD[goal]} needs.`,
      detail: goal === 'bulk'
        ? `Average ${avgIntake} kcal in, ${avgOut} out. Add ${shortfall} kcal — a glass of milk with peanut butter and a katori of rice gets you most of the way.`
        : `Average ${avgIntake} kcal in, ${avgOut} out. A deficit this large is hard to hold and usually costs you muscle; eating ${shortfall} kcal more will still get you there.`,
    });
  }

  // 2. Training days need fuel.
  const trainingDays = measured.filter((d) => d.workoutKcal > 0);
  const restDays = measured.filter((d) => d.workoutKcal === 0);
  if (trainingDays.length >= 2 && restDays.length >= 2) {
    const avgTrain = Math.round(trainingDays.reduce((t, d) => t + d.intakeKcal, 0) / trainingDays.length);
    const avgRest = Math.round(restDays.reduce((t, d) => t + d.intakeKcal, 0) / restDays.length);
    if (avgTrain < avgRest - 100) {
      out.push({
        id: 'under-fuelled-training',
        tone: 'warn',
        headline: 'You eat less on the days you train.',
        detail: `${avgTrain} kcal on training days against ${avgRest} on rest days, even though training adds about ${Math.round(trainingDays.reduce((t, d) => t + d.workoutKcal, 0) / trainingDays.length)} kcal of burn. Moving some of those calories onto gym days will make sessions feel better.`,
      });
    }
  }

  // 3. Protein, the one macro worth nagging about — gently.
  if (proteinTargetG && avgProteinG != null && avgProteinG > 0 && avgProteinG < proteinTargetG * 0.8) {
    out.push({
      id: 'low-protein',
      tone: 'warn',
      headline: `Protein is averaging ${Math.round(avgProteinG)} g against a ${proteinTargetG} g target.`,
      detail: `That is the gap most likely to cost you muscle while you ${GOAL_WORD[goal]}. Two extra katoris of dal, 150 g of paneer or a scoop of whey covers roughly ${Math.round(proteinTargetG - avgProteinG)} g.`,
    });
  }

  // 4. Movement outside the gym.
  const avgSteps = Math.round(days.reduce((t, d) => t + (d.stepsKcal > 0 ? d.stepsKcal : 0), 0) / days.length);
  if (goal === 'cut' && avgSteps > 0 && avgSteps < 120) {
    out.push({
      id: 'low-steps',
      tone: 'info',
      headline: 'Most of your burn is coming from the gym, not the day.',
      detail: `Walking is only adding about ${avgSteps} kcal a day. Another 4,000 steps is roughly ${4 * KCAL_PER_1000_STEPS} kcal — the easiest calories to spend when you do not want to eat less.`,
    });
  }

  // 5. Be honest about coverage.
  if (logged.length < days.length) {
    out.push({
      id: 'partial-logging',
      tone: 'info',
      headline: `These numbers cover ${logged.length} of the last ${days.length} days.`,
      detail: 'Days with no food logged are left out rather than counted as zero, so the averages stay honest. More logged days, sharper advice.',
    });
  }

  return out;
}
