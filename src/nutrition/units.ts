/**
 * STUB — owned by package N1 (docs/HEALTH_SPEC.md §2). The integrator
 * replaces this file wholesale with the generated unit table; nothing in
 * `src/views/nutrition/` depends on anything here beyond `FoodItem.units`,
 * so the swap is a delete-and-drop-in.
 */
import type { FoodUnit } from '../types';

/** Household measures (grams per unit) — HEALTH_SPEC §2 defaults. */
export const UNIT_GRAMS: Record<string, number> = {
  katori: 150,
  'small katori': 100,
  roti: 40,
  paratha: 80,
  idli: 40,
  dosa: 90,
  piece: 50,
  cup: 240,
  tbsp: 15,
  tsp: 5,
  glass: 250,
  plate: 300,
  serving: 100,
};

/** `unit('katori')` → `{ label: 'katori', grams: 150 }`. */
export function unit(label: string, grams?: number): FoodUnit {
  return { label, grams: grams ?? UNIT_GRAMS[label] ?? 100 };
}

const GROUP_UNITS: Record<string, string[]> = {
  cereals: ['katori', 'cup'],
  dals: ['katori', 'small katori'],
  dairy: ['katori', 'glass'],
  fruit: ['piece', 'cup'],
  'non-veg': ['piece', 'katori'],
  beverages: ['cup', 'glass'],
  breads: ['roti', 'piece'],
  oils: ['tbsp', 'tsp'],
};

/** Default units for a food group; falls back to a 100 g "serving". */
export function unitsForGroup(group?: string): FoodUnit[] {
  return (GROUP_UNITS[group ?? ''] ?? ['serving']).map((label) => unit(label));
}
