import { describe, it, expect } from 'vitest';
import {
  computeStreak, computeStreakSummary, addDays,
  MAX_FREEZES, STARTING_FREEZES, TRAINING_DAYS_TO_EARN_FREEZE,
} from '../src/streakService';
import type { Workout } from '../src/types';

// 2026-01-04 is a Sunday, so every fixture starts on a week boundary.
const WEEK_START = '2026-01-04';

/** One completed, non-rest session on a local date. */
const session = (iso: string, n = 1): Workout => ({
  id: `${iso}-${n}`,
  date: `${iso}T10:00:00`,
  name: 'Day 1 - Chest',
  type: 'custom',
  exercises: [],
  completed: true,
} as unknown as Workout);

/** `count` consecutive training days from `startIso`. */
const streak = (startIso: string, count: number): Workout[] =>
  Array.from({ length: count }, (_, i) => session(addDays(startIso, i)));

/** Local noon on a YYYY-MM-DD — `new Date('...')` alone would be UTC. */
const at = (iso: string): Date => new Date(`${iso}T12:00:00`);

describe('computeStreak — the freeze counter runs on training DAYS', () => {
  it('counts two sessions on one day once', () => {
    const twice = [session('2026-01-04', 1), session('2026-01-04', 2)];
    const r = computeStreak(twice, 1, at('2026-01-06'));
    expect(r.totalWorkoutDays).toBe(1);
    expect(r.freezeProgress).toBe(1);
    expect(r.daysUntilNextFreeze).toBe(TRAINING_DAYS_TO_EARN_FREEZE - 1);
  });

  it('does not move at 29/30 for a second session on a day already trained', () => {
    // The reported "stuck at 29/30": the user logs another workout and the
    // progress bar refuses to budge, because that day was already counted.
    const days = streak(WEEK_START, 29);
    const now = at('2026-02-03');

    const before = computeStreak(days, 1, now);
    expect(before.totalWorkoutDays).toBe(29);
    expect(before.freezeProgress).toBe(29);
    expect(before.daysUntilNextFreeze).toBe(1);
    expect(before.freezes).toBe(STARTING_FREEZES);

    const withDoubles = computeStreak(
      [...days, session('2026-01-05', 2), session('2026-01-06', 2)],
      1, now,
    );
    expect(withDoubles.totalWorkoutDays).toBe(29);
    expect(withDoubles.freezeProgress).toBe(29);
  });

  it('banks a freeze on the 30th training day and resets the progress', () => {
    const r = computeStreak(streak(WEEK_START, 30), 1, at('2026-02-03'));
    expect(r.totalWorkoutDays).toBe(30);
    expect(r.freezes).toBe(STARTING_FREEZES + 1);
    expect(r.freezeProgress).toBe(0);
    expect(r.daysUntilNextFreeze).toBe(TRAINING_DAYS_TO_EARN_FREEZE);
  });

  it('drops the day-60 milestone when the bank is already at the cap', () => {
    const r = computeStreak(streak(WEEK_START, 60), 1, at('2026-03-06'));
    expect(r.totalWorkoutDays).toBe(60);
    expect(r.freezes).toBe(MAX_FREEZES);
    expect(r.freezeProgress).toBe(0);
  });

  it('re-earns at day 60 when a freeze was spent on a missed week', () => {
    // 28 days straight, a blank week (rescued by the starting freeze), then
    // two more days — the 30th of which banks a fresh freeze.
    const days = [...streak(WEEK_START, 28), session('2026-02-08'), session('2026-02-09')];
    const r = computeStreak(days, 1, at('2026-02-10'));
    expect(r.totalWorkoutDays).toBe(30);
    expect(r.frozenWeeks.has('2026-02-01')).toBe(true);
    expect(r.freezes).toBe(1); // 1 to start, spent on the blank week, re-earned at 30
    expect(r.current).toBe(6); // 4 full weeks + the frozen one + this one
  });
});

describe('computeStreakSummary', () => {
  it('can show a level above the one the user committed to', () => {
    // Why the streak modal must render `committed`, not `shown`: with a
    // 5-day habit, picking 2 or 3 days/week leaves `shown` on 5★, so the
    // hero and legend would ignore the picker.
    const fiveADayForThreeWeeks = [0, 7, 14].flatMap((week) =>
      [0, 1, 2, 3, 4].map((d) => session(addDays(WEEK_START, week + d))),
    );
    const summary = computeStreakSummary(fiveADayForThreeWeeks, 2, at('2026-01-27'));
    expect(summary.committed.level).toBe(2);
    expect(summary.committed.current).toBe(3);
    expect(summary.shown.level).toBe(5);
  });
});
