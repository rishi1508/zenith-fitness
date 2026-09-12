// Calorie / macro target math — docs/HEALTH_SPEC.md §5. Pure functions.
import type { ActivityLevel, HealthProfile, NutritionTargets, PhaseGoal } from '../types';

export const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, 'very-active': 1.9,
};

/** Mifflin–St Jeor. Null when sex, height or birth year is missing. */
export function estimateBmr(profile: HealthProfile, weightKg: number, now: Date = new Date()): number | null {
  if (!profile.sex || !profile.heightCm || !profile.birthYear || !(weightKg > 0)) return null;
  const age = now.getFullYear() - profile.birthYear;
  const base = 10 * weightKg + 6.25 * profile.heightCm - 5 * age;
  return Math.round(profile.sex === 'male' ? base + 5 : base - 161);
}

/** BMR × activity multiplier (defaults to `moderate`). Null when BMR is unknown. */
export function estimateMaintenanceKcal(profile: HealthProfile, weightKg: number, now: Date = new Date()): number | null {
  const bmr = estimateBmr(profile, weightKg, now);
  if (bmr == null) return null;
  return Math.round(bmr * ACTIVITY_MULTIPLIER[profile.activityLevel ?? 'moderate']);
}

const KCAL_PER_KG_BODYWEIGHT = 7700;
const PROTEIN_G_PER_KG: Record<PhaseGoal, number> = { cut: 2.2, maintain: 2.0, bulk: 1.8 };

/** Where the maintenance number came from: measured intake + trend, the
 *  Mifflin–St Jeor formula, or nothing yet. Display only — it never changes
 *  the maths (docs/HEALTH_SPEC.md §5). */
export type MaintenanceBasis = 'adaptive' | 'formula' | 'none';

/** Daily targets from maintenance + goal. Rate is % body weight per week, signed (+ bulk, − cut). */
export function computeTargets(input: {
  maintenanceKcal: number;
  weightKg: number;
  goal: PhaseGoal;
  targetRatePctPerWeek: number;
  maintenanceBasis?: MaintenanceBasis;
}): NutritionTargets & { maintenanceBasis?: MaintenanceBasis } {
  const weeklyKg = (input.targetRatePctPerWeek / 100) * input.weightKg;
  const dailyDelta = (weeklyKg * KCAL_PER_KG_BODYWEIGHT) / 7;
  const kcal = Math.max(1200, Math.round((input.maintenanceKcal + dailyDelta) / 10) * 10);
  const protein = Math.round(PROTEIN_G_PER_KG[input.goal] * input.weightKg);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return {
    // A glass is 250 ml, so the target is whole glasses — 2,600 could never be met one glass at a time.
    kcal, protein, carbs, fat, waterMl: Math.max(250, Math.round(input.weightKg * 35 / 250) * 250), mode: 'auto',
    updatedAt: new Date().toISOString(),
    ...(input.maintenanceBasis ? { maintenanceBasis: input.maintenanceBasis } : {}),
  };
}
