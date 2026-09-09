import { describe, it, expect } from 'vitest';
import { daysDoneThisWeek, matchesDay, suggestNextDay } from '../src/planProgress';
import type { DayPlan, WeeklyPlan, Workout } from '../src/types';

const day = (n: number, name: string, rest = false): DayPlan => ({ dayNumber: n, name, exercises: [], isRestDay: rest });

const plan: WeeklyPlan = {
  id: 'p1',
  name: 'Push Pull Legs',
  days: [day(1, 'Day 1 - Push'), day(2, 'Day 2 - Pull'), day(3, 'Rest', true), day(4, 'Day 4 - Legs')],
};

// A Wednesday, so the week (Sunday-based) started three days earlier.
const NOW = new Date('2026-09-09T18:00:00+05:30');
const onDay = (offsetFromSunday: number) => {
  const d = new Date('2026-09-06T10:00:00+05:30');
  d.setDate(d.getDate() + offsetFromSunday);
  return d.toISOString();
};

const done = (name: string, offset: number): Workout => ({
  id: `w-${name}-${offset}`, name, date: onDay(offset), completed: true, type: 'custom', exercises: [],
} as unknown as Workout);

describe('matchesDay', () => {
  it('matches the "<plan> - <day>" name the app writes', () => {
    expect(matchesDay(done('Push Pull Legs - Day 1 - Push', 0), plan.days[0])).toBe(true);
    expect(matchesDay(done('Day 1 - Push', 0), plan.days[0])).toBe(true);
    expect(matchesDay(done('Push Pull Legs - Day 2 - Pull', 0), plan.days[0])).toBe(false);
  });
});

describe('suggestNextDay', () => {
  it('offers the first day when nothing is done', () => {
    const s = suggestNextDay(plan, [], NOW)!;
    expect(s.day.dayNumber).toBe(1);
    expect(s.doneCount).toBe(0);
    expect(s.reason).toMatch(/First session/);
  });

  it('offers the next day once the previous one is done', () => {
    const s = suggestNextDay(plan, [done('Push Pull Legs - Day 1 - Push', 1)], NOW)!;
    expect(s.day.dayNumber).toBe(2);
    expect(s.doneCount).toBe(1);
    expect(s.totalCount).toBe(3);
  });

  it('pulls back to a day that was skipped over', () => {
    // Did Legs (day 4) first — days 1 and 2 are still owed.
    const s = suggestNextDay(plan, [done('Push Pull Legs - Day 4 - Legs', 1)], NOW)!;
    expect(s.day.dayNumber).toBe(1);
    expect(s.reason).toMatch(/still pending/);
  });

  it('never suggests a rest day', () => {
    const s = suggestNextDay(plan, [
      done('Push Pull Legs - Day 1 - Push', 0),
      done('Push Pull Legs - Day 2 - Pull', 1),
    ], NOW)!;
    expect(s.day.dayNumber).toBe(4);
  });

  it('starts the next round when the cycle is complete', () => {
    const s = suggestNextDay(plan, [
      done('Push Pull Legs - Day 1 - Push', 0),
      done('Push Pull Legs - Day 2 - Pull', 1),
      done('Push Pull Legs - Day 4 - Legs', 2),
    ], NOW)!;
    expect(s.cycleComplete).toBe(true);
    expect(s.day.dayNumber).toBe(1);
  });

  it('ignores sessions from a previous week', () => {
    const lastWeek = { ...done('Push Pull Legs - Day 1 - Push', 0), date: '2026-09-01T10:00:00+05:30' } as Workout;
    expect(daysDoneThisWeek(plan, [lastWeek], NOW).size).toBe(0);
    expect(suggestNextDay(plan, [lastWeek], NOW)!.day.dayNumber).toBe(1);
  });

  it('ignores rest-day logs and unfinished sessions', () => {
    const rest = { ...done('Push Pull Legs - Day 1 - Push', 1), type: 'rest' } as Workout;
    const abandoned = { ...done('Push Pull Legs - Day 1 - Push', 1), completed: false } as Workout;
    expect(suggestNextDay(plan, [rest, abandoned], NOW)!.day.dayNumber).toBe(1);
  });

  it('has nothing to say without a plan', () => {
    expect(suggestNextDay(null, [], NOW)).toBeNull();
  });
});
