/**
 * The energy model (src/energy.ts) wired to what the app actually stores:
 * logged workouts, the activity day from Health Connect or manual entry, the
 * health profile, the latest weigh-in and the food diary.
 *
 * Read-only and cheap — everything here comes from localStorage caches that
 * are already populated, so a screen can call it on every render.
 */
import type { DayEnergy } from '../energy';
import { dayEnergy } from '../energy';
import * as storage from '../storage';
import type { Workout } from '../types';
import { getActivityDay, getHealthProfile, getNutritionDay, listActivityDays, localDateISO, addDaysISO, listNutritionDays, sumMacros } from './store';

/** Workouts logged on one local day (rest days excluded). */
export function workoutsOn(date: string, all: Workout[] = storage.getWorkouts()): Workout[] {
  return all.filter((w) => w.completed && w.type !== 'rest' && localDayOf(w.date) === date);
}

/** A workout's ISO timestamp → its local calendar day. */
function localDayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : localDateISO(d);
}

/** Everything the ledger needs for one day, read from the local caches. */
export function energyForDay(date: string = localDateISO(), now?: Date): DayEnergy {
  const profile = getHealthProfile();
  const weightKg = storage.getLatestBodyWeight()?.weight ?? 0;
  const activity = getActivityDay(date);
  const nutrition = getNutritionDay(date);
  return dayEnergy({
    date,
    profile,
    weightKg,
    workouts: workoutsOn(date),
    library: storage.getExercises(),
    steps: activity.steps,
    deviceActiveKcal: activity.activeKcal,
    intakeKcal: sumMacros(nutrition).kcal,
    now,
  });
}

/** The last `days` days, oldest first, for trends and insights. */
export function energyRange(days = 7, endDate: string = localDateISO(), now?: Date): DayEnergy[] {
  const all = storage.getWorkouts();
  const profile = getHealthProfile();
  const weightKg = storage.getLatestBodyWeight()?.weight ?? 0;
  const library = storage.getExercises();
  const activityByDate = new Map(listActivityDays(addDaysISO(endDate, -(days - 1)), endDate).map((a) => [a.date, a]));
  const nutritionByDate = new Map(listNutritionDays(addDaysISO(endDate, -(days - 1)), endDate).map((n) => [n.date, n]));

  const out: DayEnergy[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDaysISO(endDate, -i);
    const activity = activityByDate.get(date);
    const nutrition = nutritionByDate.get(date);
    out.push(dayEnergy({
      date,
      profile,
      weightKg,
      workouts: workoutsOn(date, all),
      library,
      steps: activity?.steps,
      deviceActiveKcal: activity?.activeKcal,
      intakeKcal: nutrition ? sumMacros(nutrition).kcal : 0,
      now,
    }));
  }
  return out;
}
