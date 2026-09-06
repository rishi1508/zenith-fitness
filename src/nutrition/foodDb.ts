/**
 * STUB — owned by package N1 (docs/HEALTH_SPEC.md §2).
 *
 * The real version loads `public/data/foods/index.json` + shards (IFCT 2017,
 * USDA FoodData Central, ~250 curated Indian dishes). This stand-in keeps the
 * exact same exported API over a dozen inline foods so `src/views/nutrition/`
 * compiles and is demonstrable; the integrator deletes it and drops N1's file
 * in its place. Keep all diary/search logic OUT of this file.
 */
import type { FoodItem, Macros } from '../types';
import { unit } from './units';

/** Compact search-index row (`index.json`). */
export interface FoodIndexEntry {
  id: string;
  name: string;
  aliases?: string[];
  group?: string;
  source: FoodItem['source'];
  kcal100: number;
  approx?: boolean;
}

export interface SearchOptions {
  /** Max rows returned (default 30). */
  limit?: number;
  /** Food ids to rank first — favourites and recents. */
  boost?: string[];
}

/** ODbL requires this line wherever an Open Food Facts result is shown. */
export const OFF_ATTRIBUTION = 'Data from Open Food Facts';

function food(
  id: string, name: string, source: FoodItem['source'], group: string,
  per100g: Macros, units: FoodItem['units'], extra: Partial<FoodItem> = {},
): FoodItem {
  return { id, name, source, group, per100g, units, ...extra };
}

const SAMPLE_FOODS: FoodItem[] = [
  food('dish:dal-tadka', 'Dal tadka', 'dish', 'dals',
    { kcal: 118, protein: 5.5, carbs: 14, fat: 4.2, fiber: 3.2 },
    [unit('katori'), unit('small katori')], { approx: true, aliases: ['dal', 'daal', 'toor dal'] }),
  food('dish:roti', 'Roti (whole wheat)', 'dish', 'breads',
    { kcal: 264, protein: 8.5, carbs: 51, fat: 3.2, fiber: 5.5 },
    [unit('roti'), unit('piece', 40)], { approx: true, aliases: ['chapati', 'phulka'] }),
  food('ifct:rice-cooked', 'Rice, cooked', 'ifct', 'cereals',
    { kcal: 130, protein: 2.7, carbs: 28.2, fat: 0.3, fiber: 0.4 },
    [unit('katori'), unit('cup')], { aliases: ['chawal', 'bhaat'] }),
  food('ifct:paneer', 'Paneer', 'ifct', 'dairy',
    { kcal: 296, protein: 18.3, carbs: 3.6, fat: 23.5 },
    [unit('katori'), unit('piece', 30)], { aliases: ['cottage cheese'] }),
  food('ifct:banana', 'Banana', 'ifct', 'fruit',
    { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3, fiber: 2.6 },
    [unit('piece', 118), unit('cup', 150)], { aliases: ['kela'] }),
  food('usda:chicken-breast', 'Chicken breast, cooked', 'usda', 'non-veg',
    { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
    [unit('piece', 120), unit('katori')], { aliases: ['murgh'] }),
  food('ifct:egg', 'Egg, whole, boiled', 'ifct', 'non-veg',
    { kcal: 155, protein: 13, carbs: 1.1, fat: 10.6 },
    [unit('piece', 50)], { aliases: ['anda'] }),
  food('ifct:milk-toned', 'Milk, toned', 'ifct', 'dairy',
    { kcal: 58, protein: 3.1, carbs: 4.7, fat: 3 },
    [unit('glass'), unit('cup')], { aliases: ['doodh'] }),
  food('dish:chai', 'Chai (with milk and sugar)', 'dish', 'beverages',
    { kcal: 62, protein: 1.9, carbs: 8.5, fat: 2.2 },
    [unit('cup', 150), unit('glass', 200)], { approx: true, aliases: ['tea'] }),
  food('dish:chicken-biryani', 'Chicken biryani', 'dish', 'cereals',
    { kcal: 168, protein: 8.2, carbs: 19.5, fat: 6.2, fiber: 1.1 },
    [unit('plate'), unit('katori')], { approx: true, aliases: ['biriyani'] }),
  food('dish:idli', 'Idli', 'dish', 'cereals',
    { kcal: 132, protein: 3.4, carbs: 26, fat: 0.9, fiber: 1 },
    [unit('idli'), unit('piece', 40)], { approx: true }),
  food('ifct:curd', 'Curd (dahi), toned milk', 'ifct', 'dairy',
    { kcal: 60, protein: 3.1, carbs: 4.7, fat: 3.3 },
    [unit('katori'), unit('small katori')], { aliases: ['dahi', 'yoghurt', 'yogurt'] }),
  food('dish:poha', 'Poha', 'dish', 'cereals',
    { kcal: 158, protein: 3.1, carbs: 27, fat: 4.1, fiber: 1.4 },
    [unit('katori'), unit('plate')], { approx: true, aliases: ['pohe', 'aval'] }),
];

const BY_ID = new Map(SAMPLE_FOODS.map((f) => [f.id, f]));

let indexCache: FoodIndexEntry[] | null = null;

/** Lazy-loads (and memoises) the compact search index. */
export function loadFoodIndex(): Promise<FoodIndexEntry[]> {
  if (!indexCache) {
    indexCache = SAMPLE_FOODS.map((f) => ({
      id: f.id, name: f.name, aliases: f.aliases, group: f.group,
      source: f.source, kcal100: f.per100g.kcal, approx: f.approx,
    }));
  }
  return Promise.resolve(indexCache);
}

function rank(entry: FoodIndexEntry, q: string): number {
  const names = [entry.name, ...(entry.aliases ?? [])].map((n) => n.toLowerCase());
  let best = -1;
  for (const n of names) {
    if (n === q) best = Math.max(best, 3);
    else if (n.startsWith(q)) best = Math.max(best, 2);
    else if (n.includes(q)) best = Math.max(best, 1);
  }
  return best;
}

const SOURCE_RANK: Record<FoodItem['source'], number> = { dish: 0, ifct: 1, user: 2, off: 3, usda: 4 };

/** Client-side search over the loaded index. Never hits the network. */
export function searchFoods(query: string, options: SearchOptions = {}): FoodIndexEntry[] {
  const { limit = 30, boost = [] } = options;
  const q = query.trim().toLowerCase();
  if (!indexCache) void loadFoodIndex();
  const rows = indexCache ?? [];
  const boosted = new Set(boost);
  const scored = q
    ? rows.map((e) => ({ e, r: rank(e, q) })).filter((s) => s.r >= 0)
    : rows.map((e) => ({ e, r: 0 }));
  return scored
    .sort((a, b) =>
      (boosted.has(b.e.id) ? 1 : 0) - (boosted.has(a.e.id) ? 1 : 0)
      || b.r - a.r
      || SOURCE_RANK[a.e.source] - SOURCE_RANK[b.e.source]
      || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map((s) => s.e);
}

/** Full item for an index row (loads the shard in N1's version). */
export function getFood(id: string): Promise<FoodItem | null> {
  return Promise.resolve(BY_ID.get(id) ?? null);
}

/** Open Food Facts barcode lookup (N1 adds the 500-item local cache). */
export async function lookupBarcode(code: string): Promise<FoodItem | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`
    + '?fields=product_name,brands,nutriments,serving_size,quantity';
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json() as {
      status?: number;
      product?: { product_name?: string; brands?: string; nutriments?: Record<string, number> };
    };
    const p = json.product;
    if (!p?.product_name) return null;
    const n = p.nutriments ?? {};
    return {
      id: `off:${code}`,
      name: p.product_name,
      brand: p.brands?.split(',')[0]?.trim(),
      barcode: code,
      source: 'off',
      per100g: {
        kcal: n['energy-kcal_100g'] ?? 0,
        protein: n.proteins_100g ?? 0,
        carbs: n.carbohydrates_100g ?? 0,
        fat: n.fat_100g ?? 0,
        fiber: n.fiber_100g,
        sugar: n.sugars_100g,
        sodium: n.sodium_100g != null ? Math.round(n.sodium_100g * 1000) : undefined,
      },
      units: [unit('serving')],
    };
  } catch {
    return null;
  }
}

/** Grams for `qty` of `unitLabel`. `'g'` is always available. */
export function gramsFor(item: FoodItem, qty: number, unitLabel: string): number {
  if (unitLabel === 'g') return qty;
  const u = item.units.find((x) => x.label === unitLabel);
  return u ? qty * u.grams : qty;
}

/** Scales `per100g` to an actual gram amount. */
export function macrosFor(item: FoodItem, grams: number): Macros {
  const k = grams / 100;
  const p = item.per100g;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    kcal: Math.round(p.kcal * k),
    protein: round(p.protein * k),
    carbs: round(p.carbs * k),
    fat: round(p.fat * k),
    fiber: p.fiber != null ? round(p.fiber * k) : undefined,
    sugar: p.sugar != null ? round(p.sugar * k) : undefined,
    sodium: p.sodium != null ? Math.round(p.sodium * k) : undefined,
  };
}
