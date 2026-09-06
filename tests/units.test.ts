import { describe, it, expect } from 'vitest';
import { MEASURES, GROUP_UNITS, unitGroupFor, unitsForFood, pieceGramsFor } from '../src/nutrition/units';

describe('unit table', () => {
  it('uses the household weights from the spec', () => {
    expect(MEASURES.katori).toBe(150);
    expect(MEASURES['small katori']).toBe(100);
    expect(MEASURES.roti).toBe(40);
    expect(MEASURES.paratha).toBe(80);
    expect(MEASURES.idli).toBe(40);
    expect(MEASURES.dosa).toBe(90);
    expect(MEASURES.cup).toBe(240);
    expect(MEASURES.tbsp).toBe(15);
    expect(MEASURES.tsp).toBe(5);
    expect(MEASURES.glass).toBe(250);
    expect(MEASURES.plate).toBe(300);
    expect(MEASURES.egg).toBe(50);
  });

  it('maps IFCT and USDA group strings onto unit classes', () => {
    expect(unitGroupFor('Cereals and Millets')).toBe('cereals');
    expect(unitGroupFor('Grain Legumes')).toBe('legumes');
    expect(unitGroupFor('Edible Oils and Fats')).toBe('oils');
    expect(unitGroupFor('Vegetables and Vegetable Products')).toBe('vegetables');
    expect(unitGroupFor('Finfish and Shellfish Products')).toBe('fish');
    expect(unitGroupFor('Rice dishes')).toBe('dish');
    expect(unitGroupFor(undefined)).toBe('other');
  });

  it('never offers grams as a unit — grams is implicit', () => {
    for (const units of Object.values(GROUP_UNITS)) {
      for (const u of units) expect(['g', 'gram', 'ml']).not.toContain(u.label);
    }
  });

  it('gives cereals katori and oils spoons', () => {
    expect(unitsForFood('Rice, raw, milled', 'Cereals and Millets')).toEqual([
      { label: 'katori', grams: 150 },
      { label: 'small katori', grams: 100 },
      { label: 'cup', grams: 240 },
      { label: 'tbsp', grams: 15 },
    ]);
    expect(unitsForFood('Oil, mustard', 'Edible Oils and Fats')).toEqual([
      { label: 'tbsp', grams: 15 },
      { label: 'tsp', grams: 5 },
    ]);
  });

  it('re-weighs "piece" per food', () => {
    expect(pieceGramsFor('Banana, ripe, robusta')).toBe(120);
    expect(pieceGramsFor('Bread, whole wheat')).toBe(25);
    expect(pieceGramsFor('Egg, whole, raw, fresh')).toBe(50);
    expect(pieceGramsFor('Egg, white, raw')).toBe(33);
    expect(pieceGramsFor('Chicken, breast, boneless, skinless, raw')).toBe(150);
    expect(pieceGramsFor('Amaranth seed, black')).toBeNull();
    expect(unitsForFood('Bananas, raw', 'Fruits and Fruit Juices')[0]).toEqual({ label: 'piece', grams: 120 });
  });

  it('drops "piece" for produce with no known piece weight', () => {
    const units = unitsForFood('Seaweed, kelp, raw', 'Vegetables and Vegetable Products');
    expect(units.some((u) => u.label === 'piece')).toBe(false);
  });

  it('classifies eggs and cheese by name, not by their USDA group', () => {
    expect(unitsForFood('Egg, whole, raw, fresh', 'Dairy and Egg Products')).toEqual([
      { label: 'egg', grams: 50 },
      { label: 'piece', grams: 50 },
    ]);
    expect(unitsForFood('Paneer', 'Milk and Milk Products')[0]).toEqual({ label: 'slice', grams: 20 });
  });
});
