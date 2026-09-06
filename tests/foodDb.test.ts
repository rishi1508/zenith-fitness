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
    expect(sources.indexOf('usda')).toBeGreaterThan(sources.indexOf('ifct'));
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
});
