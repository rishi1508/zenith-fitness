import { describe, it, expect } from 'vitest';
import { HEADROOM, MODEL_CASCADE, quotaDayISO, selectModel } from '../api/_modelRouter';

describe('selectModel', () => {
  it('starts on the strongest model when nothing has been used', () => {
    expect(selectModel({})).toEqual({ model: 'gemini-3.6-flash', remainingToday: 20 - HEADROOM - 1 });
  });

  it('steps down one model at a time as each budget fills', () => {
    // 19 used on a 20/day model = at the headroom line, so it moves on.
    expect(selectModel({ used: { 'gemini-3.6-flash': 19 } })?.model).toBe('gemini-3.5-flash');
    expect(
      selectModel({ used: { 'gemini-3.6-flash': 19, 'gemini-3.5-flash': 19 } })?.model,
    ).toBe('gemini-3.5-flash-lite');
  });

  it('keeps one request of headroom per model', () => {
    // 18 of 20 still has room (that request leaves 19 used, the headroom).
    expect(selectModel({ used: { 'gemini-3.6-flash': 18 } })).toEqual({ model: 'gemini-3.6-flash', remainingToday: 0 });
    expect(selectModel({ used: { 'gemini-3.6-flash': 19 } })?.model).not.toBe('gemini-3.6-flash');
  });

  it('skips a model marked exhausted even when its counter looks fine', () => {
    const pick = selectModel({ used: {}, exhausted: { 'gemini-3.6-flash': true, 'gemini-3.5-flash': true } });
    expect(pick?.model).toBe('gemini-3.5-flash-lite');
  });

  it('falls through to the lite models and then gives up', () => {
    const spent: Record<string, number> = {};
    for (const b of MODEL_CASCADE) spent[b.model] = b.perDay;
    expect(selectModel({ used: spent })).toBeNull();

    const allButLast = { ...spent };
    delete allButLast['gemini-3.7-flash'];
    expect(selectModel({ used: allButLast })).toEqual({ model: 'gemini-3.7-flash', remainingToday: 20 - HEADROOM - 1 });
  });

  it('honours a caller-supplied budget list in its given order', () => {
    const budgets = [{ model: 'a', perDay: 2 }, { model: 'b', perDay: 5 }];
    expect(selectModel({}, budgets)).toEqual({ model: 'a', remainingToday: 0 });
    expect(selectModel({ used: { a: 1 } }, budgets)?.model).toBe('b');
  });
});

describe('quotaDayISO', () => {
  it('rolls over at midnight Pacific, not UTC', () => {
    // 06:59 UTC on the 7th is still 23:59 on the 6th in Los Angeles (PDT).
    expect(quotaDayISO(new Date('2026-09-07T06:59:00Z'))).toBe('2026-09-06');
    expect(quotaDayISO(new Date('2026-09-07T07:00:00Z'))).toBe('2026-09-07');
  });

  it('formats as YYYY-MM-DD', () => {
    expect(quotaDayISO(new Date('2026-01-15T20:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
