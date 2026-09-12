import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { isAdmin } from '../../admin';
/**
 * Pure helpers behind the nutrition diary (docs/HEALTH_SPEC.md §3).
 * Everything here is side-effect free and unit-tested in
 * `tests/nutrition.test.ts` — the views keep only rendering and store calls.
 */
import type {
  ActivityLevel, FoodEntry, FoodItem, FoodSource, FoodUnit, MealSlot, NutritionDay, PhaseGoal,
  SavedMealItem,
} from '../../types';
import { ACTIVITY_MULTIPLIER } from '../../health/targets';

// Chronological, the way people eat: snacks sit between lunch and dinner.
export const MEALS: MealSlot[] = ['breakfast', 'lunch', 'snacks', 'dinner'];

export const MEAL_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks',
};

/**
 * Local-date arithmetic, duplicated from `health/store.addDaysISO` so this
 * module stays importable by tests without pulling in Firebase.
 */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** The diary never shows a future day. */
export function canGoForward(date: string, today: string): boolean {
  return date < today;
}

/** Day switcher step, clamped at `today`. */
export function shiftDate(date: string, delta: number, today: string): string {
  const next = addDays(date, delta);
  return next > today ? today : next;
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** breakfast before 11, lunch before 16, dinner before 21, else snacks —
 *  the same guess the plate scanner makes. Used by every "log food now"
 *  entry point so the meal is already right. */
export function mealForNow(now: Date = new Date()): MealSlot {
  const h = now.getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snacks';
}

// ---------- month calendar (the diary's date picker) ----------

/** First day of the month containing `date`. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Month steps work off the first of the month — "the 31st, a month back"
 *  has no answer in February. */
export function shiftMonth(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Last day of the month containing `date`. */
export function monthEnd(date: string): string {
  return addDays(shiftMonth(date, 1), -1);
}

/** "September 2026". */
export function monthTitle(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/**
 * Sun-first grid for the month containing `date`. Leading and trailing cells
 * are `null` so the grid is always a whole number of seven-day rows.
 */
export function monthGrid(date: string): (string | null)[] {
  const first = monthStart(date);
  const [y, m] = first.split('-').map(Number);
  const cells: (string | null)[] = Array<string | null>(new Date(y, m - 1, 1).getDay()).fill(null);
  const lastDay = Number(monthEnd(date).slice(8));
  for (let d = 1; d <= lastDay; d++) cells.push(`${first.slice(0, 8)}${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * The days of `date`'s month with at least one food entry, from whatever the
 * local day cache holds — no Firestore read. Water-only days are not marked:
 * the disc means "you ate and logged it".
 */
export function monthDaysWithEntries(days: NutritionDay[], date: string): Set<string> {
  const from = monthStart(date);
  const to = monthEnd(date);
  return new Set(
    days.filter((d) => d.date >= from && d.date <= to && d.entries.length > 0).map((d) => d.date),
  );
}

/** A day is pickable when it is not in the future and not before the account
 *  existed. No `minDate` (an account with no creation time) means no floor. */
export function isDatePickable(date: string, today: string, minDate?: string): boolean {
  if (date > today) return false;
  return !minDate || date >= minDate;
}

/** Firebase's `user.metadata.creationTime` as a local YYYY-MM-DD. Undefined
 *  when it is missing or unparseable, which lifts the floor entirely. */
export function accountStartDate(creationTime: string | null | undefined): string | undefined {
  if (!creationTime) return undefined;
  const d = new Date(creationTime);
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function entriesForMeal(entries: FoodEntry[], meal: MealSlot): FoodEntry[] {
  return entries.filter((e) => e.meal === meal);
}

export function mealKcal(entries: FoodEntry[], meal: MealSlot): number {
  return Math.round(entriesForMeal(entries, meal).reduce((sum, e) => sum + e.macros.kcal, 0));
}

export interface WeeklyPoint { date: string; value: number }

export interface WeekSeries {
  /** `from`..`to` inclusive, oldest first — zero for any day with nothing cached. */
  days: WeeklyPoint[];
  /** Of the days with something logged, how many reached `target`. */
  onTarget: number;
  logged: number;
}

/**
 * One `value` per day of a trailing week, zero-filled for days that aren't
 * in `days` yet, plus how many logged days reached `target`. Backs the
 * weekly kcal / water bar charts — one call per metric, since `value` and
 * `target` differ (kcal vs. glasses).
 */
export function weeklySeries(
  days: NutritionDay[],
  from: string,
  to: string,
  value: (day: NutritionDay) => number,
  target: number,
): WeekSeries {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const points: WeeklyPoint[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    const day = byDate.get(cursor);
    points.push({ date: cursor, value: day ? value(day) : 0 });
  }
  const logged = points.filter((p) => p.value > 0);
  return { days: points, onTarget: logged.filter((p) => p.value >= target).length, logged: logged.length };
}

/**
 * "Copy yesterday" — the same foods with fresh ids and timestamps so the two
 * days stay independent (deleting today's copy must not touch the original).
 */
export function copyDayEntries(
  entries: FoodEntry[],
  opts: { id: () => string; at: string },
): FoodEntry[] {
  return entries.map((e) => ({ ...e, id: opts.id(), at: opts.at }));
}

/** A diary entry without the fields that tie it to one day and slot, ready to
 *  be stored inside a `SavedMeal` and re-added later. */
export function toSavedItem(entry: FoodEntry): SavedMealItem {
  const { id, at, meal, ...rest } = entry;
  void id; void at; void meal;
  return rest;
}

export function upsertEntry(day: NutritionDay, entry: FoodEntry): NutritionDay {
  const exists = day.entries.some((e) => e.id === entry.id);
  return {
    ...day,
    entries: exists ? day.entries.map((e) => (e.id === entry.id ? entry : e)) : [...day.entries, entry],
  };
}

export function removeEntry(day: NutritionDay, entryId: string): NutritionDay {
  return { ...day, entries: day.entries.filter((e) => e.id !== entryId) };
}

/**
 * Water is counted in glasses everywhere the user sees it, but stored in
 * millilitres (`NutritionDay.waterMl`, `NutritionTargets.waterMl`) so nothing
 * in the data model or the sync payload changes. One glass is 250 ml.
 */
export const GLASS_ML = 250;

/** Millilitres → whole glasses, never negative. 750 → 3, 2730 → 11. */
export function glassesFor(ml: number): number {
  if (!Number.isFinite(ml) || ml <= 0) return 0;
  return Math.round(ml / GLASS_ML);
}

/** Whole glasses → millilitres, the figure that is actually stored. */
export function mlForGlasses(glasses: number): number {
  if (!Number.isFinite(glasses) || glasses <= 0) return 0;
  return Math.round(glasses) * GLASS_ML;
}

/** 0.25 steps for household units, 5 g/ml steps for the raw unit. Never below one step. */
export function stepQty(qty: number, unitLabel: string, dir: 1 | -1): number {
  const step = unitLabel === 'g' || unitLabel === 'ml' ? 5 : 0.25;
  const next = Math.round((qty + dir * step) / step) * step;
  return next < step ? step : Math.round(next * 100) / 100;
}

/** `1` not `1.00`, `1.5` not `1.50`. */
export function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
}

/**
 * Reconstructs a `FoodItem` from a logged entry so the edit sheet can rescale
 * macros for entries whose food is not in the database (quick adds, scans, or
 * a shard that no longer carries the id).
 */
export function foodFromEntry(entry: FoodEntry): FoodItem {
  const grams = entry.grams > 0 ? entry.grams : 100;
  const k = 100 / grams;
  const m = entry.macros;
  const unitGrams = entry.qty > 0 ? grams / entry.qty : grams;
  return {
    id: entry.foodId,
    name: entry.name,
    source: entry.source,
    approx: entry.approx,
    basis: entry.basis,
    per100g: {
      kcal: m.kcal * k, protein: m.protein * k, carbs: m.carbs * k, fat: m.fat * k,
      fiber: m.fiber != null ? m.fiber * k : undefined,
    },
    units: entry.unit === 'g' || entry.unit === 'ml' ? [] : [{ label: entry.unit, grams: unitGrams }],
  };
}

/**
 * Free-text serving list → food units. Tolerant of how people actually write
 * them: `"katori 150"`, `"1 glass = 250 ml"`, `"cup 250ml"`, `"roti - 40g"`.
 * A leading count ("1 glass") is dropped, and a trailing g/ml/gm/gram unit is
 * ignored (the food's own basis decides what the number means).
 */
export function parseUnits(text: string): FoodUnit[] {
  return text
    .split(/[,\n;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(?:\d+(?:\.\d+)?\s*)?(.+?)\s*(?:=|-|:)?\s*(\d+(?:\.\d+)?)\s*(?:g|gm|gms|gram|grams|ml|millilitre|millilitres)?$/i.exec(part);
      if (!m) return null;
      const label = m[1].replace(/[=:-]\s*$/, '').trim();
      const grams = Number(m[2]);
      return label && grams > 0 ? { label, grams } : null;
    })
    .filter((u): u is FoodUnit => u !== null);
}

/** The word this food measures its raw amount in — "ml" for drinks, else "g". */
export function basisLabel(food: { basis?: 'g' | 'ml' } | null | undefined): 'g' | 'ml' {
  return food?.basis === 'ml' ? 'ml' : 'g';
}

const SOURCE_TEXT: Record<FoodSource, string> = {
  ifct: 'IFCT 2017 · ICMR-NIN',
  usda: 'USDA FoodData Central',
  dish: 'approx.',
  off: 'Open Food Facts',
  user: 'Created by a member',
};

/** The grey line under a search result / entry. */
export function sourceLabel(source: FoodSource, opts: { brand?: string; approx?: boolean } = {}): string {
  const parts = [opts.brand, SOURCE_TEXT[source]].filter(Boolean) as string[];
  if (opts.approx && source !== 'dish') parts.push('approx.');
  return parts.join(' · ');
}

/** One-line explanation of an auto target, shown under the number. */
export function explainTargets(input: {
  bmr: number | null;
  maintenance: number | null;
  activityLevel: ActivityLevel;
  goal: PhaseGoal;
  ratePctPerWeek: number;
  weightKg: number;
  kcal: number;
}): string {
  if (input.bmr == null || input.maintenance == null) {
    return 'Add your sex, height and birth year to compute a maintenance estimate.';
  }
  const mult = ACTIVITY_MULTIPLIER[input.activityLevel];
  const base = `BMR ${input.bmr} × ${input.activityLevel} (${mult}) = ${input.maintenance} kcal maintenance`;
  if (input.goal === 'maintain' || input.ratePctPerWeek === 0) {
    return `${base}; maintaining → ${input.kcal} kcal/day.`;
  }
  const weeklyKg = (input.ratePctPerWeek / 100) * input.weightKg;
  const sign = input.ratePctPerWeek > 0 ? '+' : '−';
  return `${base}; ${input.goal} at ${sign}${Math.abs(input.ratePctPerWeek)} %/week `
    + `(${sign}${Math.abs(weeklyKg).toFixed(2)} kg) → ${input.kcal} kcal/day.`;
}

/** A member may correct the foods they created; an admin may correct any
 *  member-created one (rules mirror this on `sharedFoods`). Sourced
 *  reference data — IFCT, USDA, Open Food Facts — is not ours to edit. */
export function canEditFood(food: FoodItem | null, uid: string | undefined): boolean {
  if (!food || !uid) return false;
  if (food.source !== 'user' && food.source !== 'dish') return false;
  return food.createdBy === uid || isAdmin(uid);
}

/** Publishes a member-created food to `sharedFoods/{id}` — a create only, no
 *  listener (docs/COST_CONTROLS.md). Failures are non-fatal: the food is
 *  already saved locally. */
export function publishSharedFood(item: FoodItem): void {
  const payload: Record<string, unknown> = {
    id: item.id, name: item.name, source: 'user',
    per100g: item.per100g, units: item.units,
    createdBy: item.createdBy, createdByName: item.createdByName ?? null, createdAt: item.createdAt,
  };
  if (item.brand) payload.brand = item.brand;
  if (item.basis) payload.basis = item.basis;
  setDoc(doc(db, 'sharedFoods', item.id), payload, { merge: true })
    .catch((e) => console.warn('[Nutrition] sharedFoods publish failed', e));
}

/** Removes the community copy of a member-created food. `firestore.rules`
 *  allows the creator or an admin; a refusal (or being offline) leaves the
 *  shared doc alone and returns false, so the caller can say so. */
export async function deleteSharedFood(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'sharedFoods', id));
    return true;
  } catch (e) {
    console.warn('[Nutrition] sharedFoods delete failed', e);
    return false;
  }
}
