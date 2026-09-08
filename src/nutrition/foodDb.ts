// Food database client — docs/HEALTH_SPEC.md §2.
//
// The catalogue is static JSON built by scripts/build-food-db.mjs and served
// from /data/foods/. Search runs entirely on the device: one ~340 KB index
// (id, name, aliases, group, source, kcal) is fetched once and kept in memory,
// and the full FoodItem is only pulled from its shard when a food is opened.
// Nothing here touches Firestore — every read of this data is free.

import type { FoodItem, FoodSource, FoodUnit, Macros } from '../types';

const BASE = '/data/foods';

/** One row of index.json: `[id, name, aliases, group, source, kcal100]`. */
type IndexRow = [string, string, string[], string, FoodSource, number];

export interface FoodIndexEntry {
  id: string;
  name: string;
  aliases: string[];
  group: string;
  source: FoodSource;
  /** kcal per 100 g — enough to render a search row without loading the shard. */
  kcal100: number;
  /** Curated dishes are recipe estimates; the UI tags them "approx.". */
  approx: boolean;
}

export interface SearchOptions {
  limit?: number;
  /** Foods the user favourited or logged recently float to the top. */
  boost?: { favouriteIds?: string[]; recentIds?: string[] };
}

/** Attribution lines the UI must show next to a food (licence conditions). */
export const SOURCE_ATTRIBUTION: Record<FoodSource, string> = {
  ifct: 'Source: IFCT 2017, ICMR-NIN',
  usda: 'Source: USDA FoodData Central',
  dish: 'Approximate — typical home recipe',
  off: 'Data from Open Food Facts',
  user: 'Added by a Zenith user',
};

/** ODbL requires this next to any Open Food Facts result. */
export const OFF_ATTRIBUTION = 'Data from Open Food Facts';

// ---------------------------------------------------------------- the index

interface Searchable extends FoodIndexEntry {
  /** Lowercased, punctuation-free name + aliases, and their word starts. */
  haystack: string[];
  words: string[];
  /** The name before the first comma or bracket — "milk" for
   *  "Milk, whole, Cow", "rice" for "Rice, raw, milled", "curd" for
   *  "Curd (dahi)". Databases qualify plain foods after a comma, so this is
   *  what makes a one-word search land on the plain food rather than on a
   *  dish that merely starts with the same word ("Milk barfi"). */
  head: string;
}

let indexPromise: Promise<FoodIndexEntry[]> | null = null;
let searchable: Searchable[] = [];

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Fetch (once) and cache the search index. Served from the SW cache offline. */
export function loadFoodIndex(): Promise<FoodIndexEntry[]> {
  if (!indexPromise) {
    indexPromise = fetch(`${BASE}/index.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`food index: HTTP ${res.status}`);
        return res.json() as Promise<IndexRow[]>;
      })
      .then((rows) => {
        const entries = rows.map(([id, name, aliases, group, source, kcal100]) => ({
          id, name, aliases: aliases || [], group, source, kcal100, approx: source === 'dish',
        }));
        searchable = entries.map((e) => {
          const haystack = [normalize(e.name), ...e.aliases.map(normalize)].filter(Boolean);
          return {
            ...e,
            haystack,
            words: haystack.flatMap((h) => h.split(' ')),
            head: normalize(e.name.split(/[,(]/)[0]),
          };
        });
        return entries;
      })
      .catch((e) => { indexPromise = null; throw e; });
  }
  return indexPromise;
}

// --------------------------------------------------------------------- search

const SOURCE_RANK: Record<FoodSource, number> = { dish: 60, ifct: 40, user: 30, off: 20, usda: 0 };

/**
 * IFCT is a composition table of RAW ingredients. "Dal, bengal gram" and
 * "Rice, raw, milled" are the right answer for a lab and the wrong answer for
 * someone logging lunch, so entries from these groups sit below prepared
 * foods. Dairy, fruit, vegetables, eggs, meat and fish are left alone — those
 * rows are what people actually eat.
 */
const RAW_STAPLE_GROUPS = new Set([
  'cereals and millets', 'grain legumes', 'condiments and spices',
  'edible oils and fats', 'sugars',
]);
const RAW_PENALTY = 200;

function isRawStaple(entry: Searchable): boolean {
  return entry.source === 'ifct' && RAW_STAPLE_GROUPS.has((entry.group ?? '').toLowerCase());
}

/** Bonus for a name whose head (before the qualifier comma) IS the query —
 *  enough to lift a plain food over a dish that starts with the same word,
 *  not enough to lift a USDA row over the curated Indian dish. */
const HEAD_EXACT_BONUS = 45;

function scoreEntry(entry: Searchable, query: string, tokens: string[]): number {
  let best = 0;
  for (let i = 0; i < entry.haystack.length; i++) {
    const hay = entry.haystack[i];
    const isName = i === 0;
    let score = 0;
    if (hay === query) score = isName ? 1000 : 900;
    else if (hay.startsWith(query)) score = isName ? 700 : 600;
    else if (hay.includes(` ${query}`)) score = isName ? 500 : 440;
    else if (hay.includes(query)) score = isName ? 300 : 260;
    if (score > best) best = score;
  }
  if (!best && tokens.length > 1) {
    // Every word typed has to prefix some word of the name or an alias.
    const all = tokens.every((t) => entry.words.some((w) => w.startsWith(t)));
    if (all) best = 380;
  }
  if (!best) return 0;
  // "milk" should find milk, not "Milk barfi": a food whose name head IS the
  // query beats one that merely starts with it.
  if (entry.head === query) best += HEAD_EXACT_BONUS;
  return best + SOURCE_RANK[entry.source] - Math.min(entry.name.length, 60) * 0.5;
}

/**
 * Tokenised prefix + alias search over the index.
 * Ranked exact > startsWith > contains, dishes and IFCT ahead of USDA,
 * with favourites and recents boosted.
 *
 * Synchronous and safe to call on every keystroke; it returns [] until
 * `loadFoodIndex()` has resolved, so await that when the search view opens.
 */
export function searchFoods(query: string, opts: SearchOptions = {}): FoodIndexEntry[] {
  const limit = opts.limit ?? 30;
  const q = normalize(query);
  if (!q) return [];
  const tokens = q.split(' ').filter(Boolean);
  const favourites = new Set(opts.boost?.favouriteIds ?? []);
  const recents = new Set(opts.boost?.recentIds ?? []);

  const hits: { entry: Searchable; score: number }[] = [];
  for (const entry of searchable) {
    let score = scoreEntry(entry, q, tokens);
    if (!score) continue;
    const known = favourites.has(entry.id) || recents.has(entry.id);
    if (favourites.has(entry.id)) score += 150;
    if (recents.has(entry.id)) score += 120;
    // Raw ingredients sink — unless this user actually logs them.
    if (!known && isRawStaple(entry)) score -= RAW_PENALTY;
    hits.push({ entry, score });
  }
  hits.sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length || a.entry.name.localeCompare(b.entry.name));
  return hits.slice(0, limit).map((h) => ({
    id: h.entry.id,
    name: h.entry.name,
    aliases: h.entry.aliases,
    group: h.entry.group,
    source: h.entry.source,
    kcal100: h.entry.kcal100,
    approx: h.entry.approx,
  }));
}

// ---------------------------------------------------------------- one food

const shardCache = new Map<string, Promise<Map<string, FoodItem>>>();

function shardFor(entry: FoodIndexEntry): string {
  if (entry.source === 'ifct') return 'ifct';
  if (entry.source === 'dish') return 'dishes';
  const c = entry.name[0]?.toLowerCase() ?? '';
  return c >= 'a' && c <= 'z' ? `usda-${c}` : 'usda-0';
}

function loadShard(name: string): Promise<Map<string, FoodItem>> {
  let p = shardCache.get(name);
  if (!p) {
    p = fetch(`${BASE}/${name}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`food shard ${name}: HTTP ${res.status}`);
        return res.json() as Promise<FoodItem[]>;
      })
      .then((items) => new Map(items.map((i) => [i.id, i])))
      .catch((e) => { shardCache.delete(name); throw e; });
    shardCache.set(name, p);
  }
  return p;
}

/** Full FoodItem for an id from the index (shards are memoised after first use). */
export async function getFood(id: string): Promise<FoodItem | null> {
  const index = await loadFoodIndex();
  const entry = index.find((e) => e.id === id);
  if (!entry) return null;
  const shard = await loadShard(shardFor(entry));
  return shard.get(id) ?? null;
}

// ------------------------------------------------------------ Open Food Facts

const OFF_CACHE_KEY = 'zenith_off_cache';
const OFF_CACHE_MAX = 500;

type OffCache = Record<string, FoodItem | null>;

function readOffCache(): OffCache {
  try { return JSON.parse(localStorage.getItem(OFF_CACHE_KEY) || '{}') as OffCache; } catch { return {}; }
}

function writeOffCache(cache: OffCache): void {
  try {
    const keys = Object.keys(cache);
    // Oldest insertions first — trim from the front when over the cap.
    if (keys.length > OFF_CACHE_MAX) for (const k of keys.slice(0, keys.length - OFF_CACHE_MAX)) delete cache[k];
    localStorage.setItem(OFF_CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota — the lookup still returned a food */ }
}

interface OffNutriments {
  'energy-kcal_100g'?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  fiber_100g?: number;
  sugars_100g?: number;
  sodium_100g?: number;
}

interface OffProduct {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  quantity?: string;
  nutriments?: OffNutriments;
}

function offToFood(code: string, product: OffProduct): FoodItem | null {
  const n = product.nutriments || {};
  const name = (product.product_name || '').trim();
  if (!name || n['energy-kcal_100g'] == null) return null;
  const macros: Macros = {
    kcal: Math.round((n['energy-kcal_100g'] ?? 0) * 10) / 10,
    protein: Math.round((n.proteins_100g ?? 0) * 100) / 100,
    carbs: Math.round((n.carbohydrates_100g ?? 0) * 100) / 100,
    fat: Math.round((n.fat_100g ?? 0) * 100) / 100,
  };
  if (n.fiber_100g != null) macros.fiber = Math.round(n.fiber_100g * 100) / 100;
  if (n.sugars_100g != null) macros.sugar = Math.round(n.sugars_100g * 100) / 100;
  if (n.sodium_100g != null) macros.sodium = Math.round(n.sodium_100g * 1000); // OFF reports sodium in g
  const units: FoodUnit[] = [];
  const serving = parseServingGrams(product.serving_size);
  if (serving) units.push({ label: 'serving', grams: serving });
  const pack = parseServingGrams(product.quantity);
  if (pack && pack !== serving) units.push({ label: 'pack', grams: pack });
  return {
    id: `off:${code}`,
    name: product.brands ? `${name} (${product.brands.split(',')[0].trim()})` : name,
    source: 'off',
    brand: product.brands ? product.brands.split(',')[0].trim() : undefined,
    barcode: code,
    per100g: macros,
    units,
  };
}

/** "30 g", "250ml", "1 bar (45 g)" → grams. */
function parseServingGrams(text?: string): number | null {
  if (!text) return null;
  const m = /(\d+(?:[.,]\d+)?)\s*(g|gram|ml)\b/i.exec(text);
  if (!m) return null;
  const grams = Number.parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(grams) && grams > 0 ? Math.round(grams) : null;
}

/**
 * Barcode lookup against Open Food Facts, cached locally (500 codes).
 * Returns null when the product is unknown or has no per-100 g energy.
 */
export async function lookupBarcode(code: string): Promise<FoodItem | null> {
  const barcode = code.trim();
  if (!barcode) return null;
  const cache = readOffCache();
  if (barcode in cache) return cache[barcode];

  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`
    + '?fields=product_name,brands,nutriments,serving_size,quantity';
  const res = await fetch(url, { headers: { 'User-Agent': 'ZenithFitness/3.18 (rishimishra1508@gmail.com)' } });
  if (!res.ok) throw new Error(`Open Food Facts: HTTP ${res.status}`);
  const body = await res.json() as { status?: number; product?: OffProduct };
  const food = body.status === 1 && body.product ? offToFood(barcode, body.product) : null;
  cache[barcode] = food;
  writeOffCache(cache);
  return food;
}

// ------------------------------------------------------------------- portions

/** Grams for `qty` of `unitLabel`. Unknown labels (and "g"/"ml") are grams. */
export function gramsFor(food: Pick<FoodItem, 'units'>, qty: number, unitLabel: string): number {
  const label = (unitLabel || '').trim().toLowerCase();
  if (!label || label === 'g' || label === 'gram' || label === 'grams' || label === 'ml') return qty;
  const unit = food.units?.find((u) => u.label.toLowerCase() === label);
  return unit ? qty * unit.grams : qty;
}

/** Scale per-100 g macros by a factor, keeping optional fields optional. */
export function scaleMacros(per100g: Macros, factor: number): Macros {
  const round = (n: number) => Math.round(n * 10) / 10;
  const out: Macros = {
    kcal: Math.round(per100g.kcal * factor),
    protein: round(per100g.protein * factor),
    carbs: round(per100g.carbs * factor),
    fat: round(per100g.fat * factor),
  };
  if (per100g.fiber != null) out.fiber = round(per100g.fiber * factor);
  if (per100g.sugar != null) out.sugar = round(per100g.sugar * factor);
  if (per100g.sodium != null) out.sodium = Math.round(per100g.sodium * factor);
  return out;
}

/** Macros for a weight of this food. */
export function macrosFor(food: Pick<FoodItem, 'per100g'>, grams: number): Macros {
  return scaleMacros(food.per100g, grams / 100);
}
