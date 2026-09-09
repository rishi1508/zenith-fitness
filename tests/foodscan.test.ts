import { describe, it, expect } from 'vitest';
import { clampItem, MAX_ITEMS, parseScanPayload, repairJson } from '../api/_scanParse';
import { classifyFailure, selectModel } from '../api/_modelRouter';
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

describe('cascade failure classification', () => {
  it('only writes a model off for a real daily quota', () => {
    expect(classifyFailure(429, 'Quota exceeded for quota metric ... GenerateRequestsPerDayPerProject')).toBe('exhausted');
    expect(classifyFailure(404, 'models/gemini-x is not found')).toBe('exhausted');
  });

  it('treats a demand spike as transient, not as exhaustion', () => {
    // The 2026-09-09 bug: this wrote off the three strongest models after
    // 1-2 calls out of 20 each, for the whole day.
    expect(classifyFailure(503, 'This model is currently experiencing high demand.')).toBe('transient');
    expect(classifyFailure(500, 'Internal error encountered.')).toBe('transient');
    expect(classifyFailure(502, '')).toBe('transient');
    expect(classifyFailure(504, '')).toBe('transient');
  });

  it('treats a per-minute rate limit as transient too', () => {
    expect(classifyFailure(429, 'Quota exceeded ... GenerateRequestsPerMinutePerProject')).toBe('transient');
    expect(classifyFailure(429, 'Too many requests per minute')).toBe('transient');
  });

  it('calls a malformed request fatal — no other model will do better', () => {
    expect(classifyFailure(400, 'Invalid JSON payload')).toBe('fatal');
    expect(classifyFailure(403, 'API key not valid')).toBe('fatal');
  });
});

describe('model selection', () => {
  const budgets = [
    { model: 'strong', perDay: 20 },
    { model: 'mid', perDay: 20 },
    { model: 'weak', perDay: 500 },
  ];

  it('takes the strongest model with budget left', () => {
    expect(selectModel({}, budgets)?.model).toBe('strong');
  });

  it('skips a model that is exhausted for the day', () => {
    expect(selectModel({ exhausted: { strong: true } }, budgets)?.model).toBe('mid');
  });

  it('skips a model that already failed this request without touching its budget', () => {
    const pick = selectModel({ used: { strong: 3 } }, budgets, new Set(['strong']));
    expect(pick?.model).toBe('mid');
    // Nothing was written off: a later request still gets the strong model.
    expect(selectModel({ used: { strong: 3 } }, budgets)?.model).toBe('strong');
  });

  it('gives up only when every model is spent', () => {
    expect(selectModel({ exhausted: { strong: true, mid: true, weak: true } }, budgets)).toBeNull();
  });
});

describe('scan items matched to a database food', () => {
  const base = {
    name: 'Rajma', grams: 200, kcal: 280, protein: 14, carbs: 40, fat: 6, confidence: 0.6,
  };

  it('re-scales a matched food from its real per-100 g figures', () => {
    const matched = { ...base, foodId: 'ifct_rajma', source: 'ifct' as const, per100g: { kcal: 140, protein: 7, carbs: 20, fat: 3 } };
    const scaled = scaleScanItem(matched, 300);
    expect(scaled.kcal).toBe(420);
    expect(scaled.protein).toBe(21);
    expect(scaled.foodId).toBe('ifct_rajma');
  });

  it('keeps scaling the model\'s own estimate proportionally', () => {
    const scaled = scaleScanItem(base, 100);
    expect(scaled.kcal).toBe(140);
    expect(scaled.foodId).toBeUndefined();
  });

  it('links the diary entry to the matched food and drops the approx flag', () => {
    const matched = { ...base, foodId: 'ifct_rajma', source: 'ifct' as const, per100g: { kcal: 140, protein: 7, carbs: 20, fat: 3 } };
    const entry = scanItemToEntry(matched, 'lunch');
    expect(entry.foodId).toBe('ifct_rajma');
    expect(entry.source).toBe('ifct');
    expect(entry.approx).toBe(false);
    // An unmatched item stays an estimate behind a scan: id.
    expect(scanItemToEntry(base, 'lunch').approx).toBe(true);
    expect(scanItemToEntry(base, 'lunch').foodId).toBe('scan:rajma');
  });
});
