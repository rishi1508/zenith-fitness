import { describe, it, expect } from 'vitest';
import type { FoodEntry, NutritionDay } from '../src/types';
import {
  GLASS_ML, addDays, canGoForward, copyDayEntries, dayLabel, entriesForMeal, explainTargets,
  foodFromEntry, formatQty, glassesFor, mealKcal, mlForGlasses, parseUnits, removeEntry, shiftDate,
  sourceLabel, stepQty, upsertEntry,
} from '../src/views/nutrition/nutritionHelpers';

function entry(over: Partial<FoodEntry> = {}): FoodEntry {
  return {
    id: 'e1', foodId: 'dish:dal-tadka', name: 'Dal tadka', source: 'dish', meal: 'lunch',
    qty: 1, unit: 'katori', grams: 150,
    macros: { kcal: 177, protein: 8.3, carbs: 21, fat: 6.3 },
    at: '2026-09-06T07:00:00.000Z', approx: true,
    ...over,
  };
}

const day: NutritionDay = {
  date: '2026-09-07',
  entries: [entry(), entry({ id: 'e2', meal: 'breakfast', name: 'Roti', macros: { kcal: 106, protein: 3.4, carbs: 20.4, fat: 1.3 } })],
  waterMl: 500,
  updatedAt: '2026-09-07T07:00:00.000Z',
};

describe('day switching', () => {
  it('steps back and forward', () => {
    expect(addDays('2026-09-07', -1)).toBe('2026-09-06');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('never goes past today', () => {
    expect(canGoForward('2026-09-07', '2026-09-07')).toBe(false);
    expect(canGoForward('2026-09-06', '2026-09-07')).toBe(true);
    expect(shiftDate('2026-09-07', 1, '2026-09-07')).toBe('2026-09-07');
    expect(shiftDate('2026-09-06', 1, '2026-09-07')).toBe('2026-09-07');
    expect(shiftDate('2026-09-07', -1, '2026-09-07')).toBe('2026-09-06');
  });

  it('labels today and yesterday by name', () => {
    expect(dayLabel('2026-09-07', '2026-09-07')).toBe('Today');
    expect(dayLabel('2026-09-06', '2026-09-07')).toBe('Yesterday');
    expect(dayLabel('2026-09-01', '2026-09-07')).toMatch(/Sep/);
  });
});

describe('copy yesterday', () => {
  it('gives every copied entry a fresh id and timestamp', () => {
    let n = 0;
    const copies = copyDayEntries(day.entries, { id: () => `new-${++n}`, at: '2026-09-07T09:00:00.000Z' });
    expect(copies.map((c) => c.id)).toEqual(['new-1', 'new-2']);
    expect(copies.every((c) => c.at === '2026-09-07T09:00:00.000Z')).toBe(true);
    // Same food, same portion, same meal.
    expect(copies[0].foodId).toBe('dish:dal-tadka');
    expect(copies[0].qty).toBe(1);
    expect(copies[1].meal).toBe('breakfast');
  });

  it('does not mutate the source day', () => {
    const before = JSON.stringify(day.entries);
    copyDayEntries(day.entries, { id: () => 'x', at: 'now' });
    expect(JSON.stringify(day.entries)).toBe(before);
  });
});

describe('entry writes', () => {
  it('appends an unknown entry and replaces a known one', () => {
    const added = upsertEntry(day, entry({ id: 'e3', meal: 'dinner' }));
    expect(added.entries).toHaveLength(3);
    const edited = upsertEntry(added, entry({ id: 'e1', qty: 2, macros: { kcal: 354, protein: 16.6, carbs: 42, fat: 12.6 } }));
    expect(edited.entries).toHaveLength(3);
    expect(edited.entries.find((e) => e.id === 'e1')?.qty).toBe(2);
  });

  it('removes by id', () => {
    expect(removeEntry(day, 'e1').entries.map((e) => e.id)).toEqual(['e2']);
    expect(removeEntry(day, 'nope').entries).toHaveLength(2);
  });

  it('sums a meal', () => {
    expect(entriesForMeal(day.entries, 'lunch')).toHaveLength(1);
    expect(mealKcal(day.entries, 'lunch')).toBe(177);
    expect(mealKcal(day.entries, 'snacks')).toBe(0);
  });
});

describe('quantity stepper', () => {
  it('uses 0.25 steps for units and 5 g steps for grams', () => {
    expect(stepQty(1, 'katori', 1)).toBe(1.25);
    expect(stepQty(1, 'katori', -1)).toBe(0.75);
    expect(stepQty(100, 'g', 1)).toBe(105);
    expect(stepQty(100, 'g', -1)).toBe(95);
  });

  it('never drops below one step', () => {
    expect(stepQty(0.25, 'katori', -1)).toBe(0.25);
    expect(stepQty(5, 'g', -1)).toBe(5);
  });

  it('formats without trailing zeros', () => {
    expect(formatQty(1)).toBe('1');
    expect(formatQty(1.5)).toBe('1.5');
    expect(formatQty(0.25)).toBe('0.25');
  });
});

describe('water in glasses', () => {
  it('counts a glass as 250 ml', () => {
    expect(GLASS_ML).toBe(250);
    expect(glassesFor(750)).toBe(3);
    expect(mlForGlasses(3)).toBe(750);
  });

  it('rounds an auto target to whole glasses', () => {
    // computeTargets rounds to the nearest 50 ml, so goals are rarely exact.
    expect(glassesFor(2730)).toBe(11);
    expect(glassesFor(2750)).toBe(11);
    expect(glassesFor(3000)).toBe(12);
  });

  it('never goes negative or NaN', () => {
    expect(glassesFor(0)).toBe(0);
    expect(glassesFor(-500)).toBe(0);
    expect(glassesFor(Number.NaN)).toBe(0);
    expect(mlForGlasses(-2)).toBe(0);
    expect(mlForGlasses(Number.NaN)).toBe(0);
  });

  it('round-trips whole glasses', () => {
    for (const n of [0, 1, 4, 12]) expect(glassesFor(mlForGlasses(n))).toBe(n);
  });
});

describe('foodFromEntry', () => {
  it('rebuilds per-100 g macros and the logged unit', () => {
    const food = foodFromEntry(entry());
    expect(food.per100g.kcal).toBeCloseTo(118, 5);
    expect(food.per100g.protein).toBeCloseTo(5.533, 2);
    expect(food.units).toEqual([{ label: 'katori', grams: 150 }]);
    expect(food.approx).toBe(true);
  });

  it('handles a grams entry (no household unit)', () => {
    const food = foodFromEntry(entry({ unit: 'g', qty: 150, grams: 150 }));
    expect(food.units).toEqual([]);
    expect(food.per100g.carbs).toBeCloseTo(14, 5);
  });
});

describe('parseUnits', () => {
  it('parses label + grams pairs', () => {
    expect(parseUnits('katori 150, piece 40')).toEqual([
      { label: 'katori', grams: 150 }, { label: 'piece', grams: 40 },
    ]);
    expect(parseUnits('small katori 100')).toEqual([{ label: 'small katori', grams: 100 }]);
  });

  it('drops malformed and zero-gram entries', () => {
    expect(parseUnits('katori, piece 0, cup 240')).toEqual([{ label: 'cup', grams: 240 }]);
    expect(parseUnits('   ')).toEqual([]);
  });
});

describe('sourceLabel', () => {
  it('names the source, with the brand first for barcode hits', () => {
    expect(sourceLabel('ifct')).toBe('IFCT 2017 · ICMR-NIN');
    expect(sourceLabel('usda')).toBe('USDA FoodData Central');
    expect(sourceLabel('dish', { approx: true })).toBe('approx.');
    expect(sourceLabel('off', { brand: 'Amul' })).toBe('Amul · Open Food Facts');
    expect(sourceLabel('user', { approx: true })).toBe('Created by a member · approx.');
  });
});

describe('explainTargets', () => {
  it('spells out the derivation for a cut', () => {
    expect(explainTargets({
      bmr: 1758, maintenance: 2725, activityLevel: 'moderate', goal: 'cut',
      ratePctPerWeek: -0.5, weightKg: 78, kcal: 2300,
    })).toBe('BMR 1758 × moderate (1.55) = 2725 kcal maintenance; cut at −0.5 %/week (−0.39 kg) → 2300 kcal/day.');
  });

  it('drops the rate clause when maintaining', () => {
    expect(explainTargets({
      bmr: 1758, maintenance: 2725, activityLevel: 'moderate', goal: 'maintain',
      ratePctPerWeek: 0, weightKg: 78, kcal: 2730,
    })).toContain('maintaining → 2730 kcal/day.');
  });

  it('asks for the missing profile fields when BMR is unknown', () => {
    expect(explainTargets({
      bmr: null, maintenance: null, activityLevel: 'moderate', goal: 'cut',
      ratePctPerWeek: -0.5, weightKg: 78, kcal: 0,
    })).toMatch(/sex, height and birth year/);
  });
});
