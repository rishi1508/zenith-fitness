import { describe, it, expect } from 'vitest';
import { clampItem, MAX_ITEMS, parseScanPayload, repairJson } from '../api/_scanParse';
import { scaleScanItem, scanItemToEntry, slugifyFood } from '../src/nutrition/scan';

describe('repairJson', () => {
  it('unwraps a ```json fence', () => {
    expect(repairJson('```json\n{"items":[],"note":"hi"}\n```')).toBe('{"items":[],"note":"hi"}');
  });

  it('drops prose either side of the object', () => {
    expect(repairJson('Sure! Here it is:\n{"items":[]}\nHope that helps.')).toBe('{"items":[]}');
  });

  it('removes trailing commas', () => {
    expect(repairJson('{"items":[1,2,],}')).toBe('{"items":[1,2]}');
  });

  it('wraps a bare array of items', () => {
    expect(repairJson('[{"name":"Roti"}]')).toBe('{"items":[{"name":"Roti"}],"note":""}');
  });
});

describe('parseScanPayload', () => {
  it('parses a well-formed reply', () => {
    const p = parseScanPayload('{"items":[{"name":"Dal Tadka","grams":150,"kcal":180,"protein":9,"carbs":22,"fat":6,"confidence":0.8}],"note":"1 katori dal"}');
    expect(p).toEqual({
      items: [{ name: 'Dal Tadka', grams: 150, kcal: 180, protein: 9, carbs: 22, fat: 6, confidence: 0.8 }],
      note: '1 katori dal',
    });
  });

  it('survives fences, trailing commas and missing note', () => {
    const p = parseScanPayload('```\n{"items":[{"name":"Roti","grams":40,"kcal":120,"protein":3,"carbs":24,"fat":1,"confidence":0.9},],}\n```');
    expect(p?.items).toHaveLength(1);
    expect(p?.note).toBe('');
  });

  it('returns null when there is no JSON at all', () => {
    expect(parseScanPayload("I can't tell what that is.")).toBeNull();
    expect(parseScanPayload('')).toBeNull();
  });

  it('drops items with no name and caps the list', () => {
    const many = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => `{"name":"Item ${i}","grams":10,"kcal":10}`);
    const p = parseScanPayload(`{"items":[${many.join(',')},{"grams":50,"kcal":50}],"note":""}`);
    expect(p?.items).toHaveLength(MAX_ITEMS);
  });

  it('truncates a runaway note', () => {
    const p = parseScanPayload(`{"items":[],"note":"${'x'.repeat(500)}"}`);
    expect(p?.note.length).toBe(300);
  });
});

describe('clampItem', () => {
  it('bounds every number to something a plate can hold', () => {
    expect(clampItem({ name: 'Rice', grams: 99999, kcal: -20, protein: 900, carbs: 3.14159, fat: 2, confidence: 5 })).toEqual({
      name: 'Rice', grams: 2000, kcal: 0, protein: 500, carbs: 3.1, fat: 2, confidence: 1,
    });
  });

  it('reads numbers out of the strings models sometimes send', () => {
    const item = clampItem({ name: '  Aloo   Sabzi ', grams: '≈ 150 g', kcal: '210 kcal' });
    expect(item).toMatchObject({ name: 'Aloo Sabzi', grams: 150, kcal: 210 });
    // Missing macros default to 0, confidence to a neutral 0.5.
    expect(item).toMatchObject({ protein: 0, carbs: 0, fat: 0, confidence: 0.5 });
  });

  it('rejects anything without a usable name', () => {
    expect(clampItem({ grams: 100 })).toBeNull();
    expect(clampItem({ name: '   ' })).toBeNull();
    expect(clampItem('Roti')).toBeNull();
  });
});

describe('scan → diary mapping', () => {
  const item = { name: 'Paneer Butter Masala', grams: 200, kcal: 400, protein: 14, carbs: 18, fat: 30, confidence: 0.7 };

  it('slugifies names for the scan: food id', () => {
    expect(slugifyFood('Dal Tadka (home)')).toBe('dal-tadka-home');
    expect(slugifyFood('!!!')).toBe('item');
  });

  it('scales macros proportionally when the user corrects the grams', () => {
    expect(scaleScanItem(item, 100)).toMatchObject({ grams: 100, kcal: 200, protein: 7, carbs: 9, fat: 15 });
    expect(scaleScanItem(item, 250)).toMatchObject({ grams: 250, kcal: 500, protein: 17.5 });
  });

  it('maps to an approximate dish entry', () => {
    const entry = scanItemToEntry(item, 'dinner', new Date('2026-09-07T19:30:00Z'));
    expect(entry).toMatchObject({
      foodId: 'scan:paneer-butter-masala',
      name: 'Paneer Butter Masala',
      source: 'dish',
      meal: 'dinner',
      qty: 200,
      unit: 'g',
      grams: 200,
      approx: true,
      at: '2026-09-07T19:30:00.000Z',
    });
    expect(entry.macros).toEqual({ kcal: 400, protein: 14, carbs: 18, fat: 30 });
  });
});
