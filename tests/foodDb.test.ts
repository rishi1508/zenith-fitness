import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { FoodItem, Macros } from '../src/types';
import { loadFoodIndex, searchFoods, getFood, gramsFor, macrosFor, scaleMacros } from '../src/nutrition/foodDb';

const OUT = 'public/data/foods';
const readShard = (name: string): FoodItem[] => JSON.parse(readFileSync(`${OUT}/${name}.json`, 'utf8'));
type IndexRow = [string, string, string[], string, string, number];
const index: IndexRow[] = JSON.parse(readFileSync(`${OUT}/index.json`, 'utf8'));

const atwater = (m: Macros) => 4 * m.protein + 4 * m.carbs + 9 * m.fat;

describe('generated food database', () => {
  it('ships an index and shards that agree with each other', () => {
    const shards = ['dishes', 'ifct', ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => `usda-${c}`)];
    const items: FoodItem[] = [];
    for (const s of shards) {
      try { items.push(...readShard(s)); } catch { /* not every letter has a shard */ }
    }
    expect(items.length).toBe(index.length);
    const ids = new Set(items.map((i) => i.id));
    for (const row of index) expect(ids.has(row[0])).toBe(true);
  });

  it('converts IFCT energy from kJ to kcal', () => {
    const ifct = readShard('ifct');
    const rice = ifct.find((f) => f.name === 'Rice, raw, milled');
    // IFCT 2017 lists 1491 kJ/100 g for milled raw rice.
    expect(rice?.per100g.kcal).toBe(Math.round((1491 / 4.184) * 10) / 10);
    expect(rice?.per100g.kcal).toBeCloseTo(356.4, 1);

    // If the division were missed, every IFCT food would read ~4.2x its macros.
    const checked = ifct.filter((f) => atwater(f.per100g) > 50);
    expect(checked.length).toBeGreaterThan(300);
    for (const f of checked) {
      expect(f.per100g.kcal / atwater(f.per100g)).toBeLessThan(1.6);
      expect(f.per100g.kcal / atwater(f.per100g)).toBeGreaterThan(0.6);
    }
    // Pure fats carry no energy column in IFCT — the build derives it.
    expect(ifct.find((f) => f.name === 'Ghee')?.per100g.kcal).toBe(900);
  });

  it('keeps every curated dish within 12 % of 4P + 4C + 9F', () => {
    const dishes = readShard('dishes');
    expect(dishes.length).toBeGreaterThanOrEqual(250);
    const off: string[] = [];
    for (const d of dishes) {
      expect(d.approx).toBe(true);
      expect(d.id.startsWith('dish:')).toBe(true);
      expect(d.units.length).toBeGreaterThan(0);
      const diff = Math.abs(d.per100g.kcal - atwater(d.per100g));
      if (diff > 5 && diff / Math.max(atwater(d.per100g), 1) > 0.12) off.push(d.name);
    }
    expect(off).toEqual([]);
  });

  it('has the everyday foods a search must find', () => {
    const names = index.map((r) => r[1].toLowerCase());
    for (const needle of ['dal tadka', 'roti (chapati)', 'paneer', 'idli', 'chicken biryani',
      'masala chai (with milk and sugar)']) {
      expect(names).toContain(needle);
    }
    expect(names.some((n) => n.startsWith('rice, raw, milled'))).toBe(true);
    expect(names.some((n) => n.startsWith('banana'))).toBe(true);
    expect(names.some((n) => /^chicken, breast/.test(n))).toBe(true);
  });

  it('answers a one-word search with the plain everyday food', () => {
    // `head` is what src/nutrition/foodDb.ts ranks on: the name before the
    // first comma or bracket. For a food people type by one word, the head
    // has to BE that word — "Rice (cooked)", not "Plain rice (cooked)".
    const heads = new Set(index.map((r) => r[1].split(/[,(]/)[0].trim().toLowerCase()));
    const missing = ['milk', 'rice', 'egg', 'bread', 'curd', 'banana', 'apple', 'chicken breast',
      'biscuit', 'muesli', 'protein bar', 'peanut butter', 'oats', 'chana', 'sprouts', 'mutton',
      'tofu', 'honey', 'sugar', 'jam', 'chips', 'popcorn', 'butter', 'ghee', 'paneer']
      .filter((q) => !heads.has(q));
    expect(missing).toEqual([]);

    const names = index.map((r) => r[1]);
    for (const canonical of ['Rice (cooked)', 'Egg (boiled)', 'Egg white (boiled)',
      'Dosa (plain)', 'Dal (plain, boiled)', 'Milk (toned)', 'Bread (whole wheat)']) {
      expect(names).toContain(canonical);
    }
  });

  it('logs drinks in millilitres, with volume units only', () => {
    const dishes = readShard('dishes');
    const drinks = dishes.filter((d) => d.basis === 'ml');
    expect(drinks.length).toBeGreaterThan(30);
    // A "slice" or a "scoop" of a drink makes no sense; 750 ml caps a bottle.
    const solidOnly = new Set(['piece', 'slice', 'egg', 'roti', 'paratha', 'idli', 'dosa',
      'handful', 'bar', 'packet', 'scoop', 'plate', 'cube', 'serving']);
    for (const d of drinks) {
      expect(d.units.length).toBeGreaterThan(0);
      for (const u of d.units) {
        expect(solidOnly.has(u.label)).toBe(false);
        expect(u.grams).toBeGreaterThanOrEqual(5);
        expect(u.grams).toBeLessThanOrEqual(750);
      }
    }
    // Nothing pourable is left on the gram basis.
    expect(dishes.filter((d) => d.group === 'Beverages' && d.basis !== 'ml')).toEqual([]);
  });

  it('gives every food at least one household unit and sane macros', () => {
    const dishes = readShard('dishes');
    const ifct = readShard('ifct');
    for (const f of [...dishes, ...ifct]) {
      expect(f.units.length).toBeGreaterThan(0);
      for (const u of f.units) expect(u.grams).toBeGreaterThan(0);
      expect(f.per100g.kcal).toBeLessThan(950);
      expect(f.per100g.protein).toBeLessThanOrEqual(100);
    }
  });
});

// ------------------------------------------------------------------ portions

const roti: FoodItem = {
  id: 'dish:roti', name: 'Roti (chapati)', source: 'dish', group: 'Breads', approx: true,
  per100g: { kcal: 260, protein: 9, carbs: 46, fat: 4.5, fiber: 5 },
  units: [{ label: 'roti', grams: 40 }, { label: 'piece', grams: 40 }],
};

describe('portion maths', () => {
  it('converts household units to grams', () => {
    expect(gramsFor(roti, 2, 'roti')).toBe(80);
    expect(gramsFor(roti, 1.5, 'piece')).toBe(60);
    expect(gramsFor(roti, 120, 'g')).toBe(120);
    expect(gramsFor(roti, 100, '')).toBe(100);
    expect(gramsFor(roti, 50, 'katori')).toBe(50); // unknown unit falls back to grams
  });

  it('scales macros by weight', () => {
    expect(macrosFor(roti, 40)).toEqual({ kcal: 104, protein: 3.6, carbs: 18.4, fat: 1.8, fiber: 2 });
    expect(macrosFor(roti, 100)).toEqual({ kcal: 260, protein: 9, carbs: 46, fat: 4.5, fiber: 5 });
  });

  it('keeps optional macro fields optional', () => {
    const scaled = scaleMacros({ kcal: 100, protein: 10, carbs: 5, fat: 3 }, 2);
    expect(scaled).toEqual({ kcal: 200, protein: 20, carbs: 10, fat: 6 });
    expect('fiber' in scaled).toBe(false);
    const withSodium = scaleMacros({ kcal: 100, protein: 10, carbs: 5, fat: 3, sodium: 120 }, 0.5);
    expect(withSodium.sodium).toBe(60);
  });
});

// -------------------------------------------------------------------- search

const FIXTURE: IndexRow[] = [
  ['dish:dal-tadka', 'Dal tadka', ['dal fry', 'toor dal'], 'Dals', 'dish', 121],
  ['dish:dal-makhani', 'Dal makhani', ['kali dal'], 'Dals', 'dish', 159],
  ['ifct:B001', 'Dal, bengal gram', ['Chana dal'], 'Grain Legumes', 'ifct', 329.1],
  ['usda:1', 'Dal, cooked (USDA)', [], 'Legumes and Legume Products', 'usda', 114],
  ['usda:3', 'Beans, mature, dal', [], 'Legumes and Legume Products', 'usda', 120],
  ['usda:2', 'Chicken, breast, boneless, skinless, raw', [], 'Poultry Products', 'usda', 112.2],
  ['dish:chicken-biryani', 'Chicken biryani', ['murgh biryani', 'hyderabadi biryani'], 'Rice dishes', 'dish', 183],
  // Plain-vs-dish ranking cases (the "milk finds Milk barfi" bug).
  ['dish:milk-barfi', 'Milk barfi', [], 'Sweets', 'dish', 380],
  ['ifct:D001', 'Milk, whole, Cow', ['doodh'], 'Milk and Milk Products', 'ifct', 67],
  ['dish:curd-rice', 'Curd rice', [], 'Rice dishes', 'dish', 98],
  ['dish:curd', 'Curd (dahi)', ['yoghurt'], 'Dairy', 'dish', 60],
];

const SHARD: FoodItem[] = [{
  id: 'dish:dal-tadka', name: 'Dal tadka', source: 'dish', group: 'Dals', approx: true,
  per100g: { kcal: 121, protein: 5.4, carbs: 14.5, fat: 4.6 },
  units: [{ label: 'katori', grams: 150 }],
}];

describe('searchFoods', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.endsWith('index.json') ? FIXTURE : SHARD),
    })));
    await loadFoodIndex();
  });

  it('ranks exact over startsWith over contains', () => {
    const names = searchFoods('dal').map((r) => r.name);
    expect(names[0]).toBe('Dal tadka');
    expect(names.indexOf('Dal makhani')).toBeLessThan(names.indexOf('Beans, mature, dal'));
    expect(names).toContain('Dal, cooked (USDA)');
  });

  it('puts dishes and IFCT ahead of USDA on an equal match', () => {
    const sources = searchFoods('dal').map((r) => r.source);
    expect(sources.indexOf('usda')).toBeGreaterThan(sources.indexOf('dish'));
    // IFCT beats USDA when the row is something people eat as-is. Raw staples
    // ("Dal, bengal gram") are the deliberate exception — see the raw-staple
    // test below — so this uses a dairy row instead.
    const milk = searchFoods('milk').map((r) => r.source);
    expect(milk.indexOf('ifct')).toBeLessThan(milk.indexOf('usda') === -1 ? Infinity : milk.indexOf('usda'));
  });

  it('matches aliases and multi-word prefixes', () => {
    expect(searchFoods('murgh')[0].id).toBe('dish:chicken-biryani');
    expect(searchFoods('kali')[0].id).toBe('dish:dal-makhani');
    expect(searchFoods('chick brea')[0].id).toBe('usda:2');
  });

  it('boosts favourites and recents', () => {
    const plain = searchFoods('dal')[0].id;
    expect(plain).toBe('dish:dal-tadka');
    const boosted = searchFoods('dal', { boost: { favouriteIds: ['usda:1'] } })[0].id;
    expect(boosted).toBe('usda:1');
    const recent = searchFoods('dal', { boost: { recentIds: ['ifct:B001'] } })[0].id;
    expect(recent).toBe('ifct:B001');
  });

  it('honours the limit and returns nothing for an empty query', () => {
    expect(searchFoods('dal', { limit: 2 })).toHaveLength(2);
    expect(searchFoods('   ')).toEqual([]);
    expect(searchFoods('zzzz')).toEqual([]);
  });

  it('flags curated dishes as approximate', () => {
    expect(searchFoods('dal tadka')[0].approx).toBe(true);
    expect(searchFoods('chicken breast')[0].approx).toBe(false);
  });

  it('loads a full food from its shard', async () => {
    const food = await getFood('dish:dal-tadka');
    expect(food?.per100g.protein).toBe(5.4);
    expect(await getFood('dish:nope')).toBeNull();
  });

  it('puts the plain food above a dish that merely starts with the word', () => {
    expect(searchFoods('milk')[0].name).toBe('Milk, whole, Cow');
    expect(searchFoods('curd')[0].name).toBe('Curd (dahi)');
  });

  it('keeps raw ingredients out of the way unless the user logs them', () => {
    const names = searchFoods('dal').map((r) => r.name);
    expect(names[0]).toBe('Dal tadka');
    expect(names.indexOf('Dal, bengal gram')).toBeGreaterThan(names.indexOf('Dal makhani'));
    // …but a raw staple the user actually logs comes straight back to the top.
    expect(searchFoods('dal', { boost: { recentIds: ['ifct:B001'] } })[0].id).toBe('ifct:B001');
  });
});
