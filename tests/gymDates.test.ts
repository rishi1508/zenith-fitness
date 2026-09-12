import { describe, it, expect } from 'vitest';
import { addMonthsISO } from '../src/gymStats';

describe('addMonthsISO', () => {
  it('adds whole months', () => {
    expect(addMonthsISO('2026-09-12', 1)).toBe('2026-10-12');
    expect(addMonthsISO('2026-09-12', 12)).toBe('2027-09-12');
  });

  it('clamps to the last day of a shorter month instead of spilling over', () => {
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsISO('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsISO('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonthsISO('2026-08-31', 6)).toBe('2027-02-28');
  });

  it('accepts a full ISO timestamp and returns a date', () => {
    expect(addMonthsISO('2026-05-31T18:30:00.000Z', 1)).toBe('2026-06-30');
  });
});
