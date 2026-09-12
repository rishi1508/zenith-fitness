import { describe, it, expect } from 'vitest';
import { computeWeeklySummary } from '../src/coachService';
import type { Workout } from '../src/types';

/** Local noon so the Sun→Sat week bucket is the same one a user would see. */
function localNoonDaysAgo(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function workout(date: string, sets: Array<[number, number]>, over: Partial<Workout> = {}): Workout {
  return {
    id: `w_${date}`,
    date,
    name: 'Push',
    type: 'push',
    completed: true,
    exercises: [{
      id: `we_${date}`,
      exerciseId: 'bench',
      exerciseName: 'Bench Press',
      sets: sets.map(([weight, reps], i) => ({ id: `s${i}`, weight, reps, completed: true })),
    }],
    ...over,
  };
}

describe('computeWeeklySummary and deload weeks', () => {
  const lastWeek = workout(localNoonDaysAgo(7), [[50, 40]]); // 2 000 kg
  const thisWeek = workout(localNoonDaysAgo(0), [[50, 20]]); // 1 000 kg

  it('reports the real week-on-week drop when neither week is a deload', () => {
    const out = computeWeeklySummary([lastWeek, thisWeek]);
    expect(out.sessions).toBe(1);
    expect(out.volume).toBe(1000);
    expect(out.volumeDelta).toBe(-1000);
  });

  it('reports no change when this week was a planned easy week', () => {
    const out = computeWeeklySummary([lastWeek, { ...thisWeek, deload: true }]);
    // The session still counts and the sparkline still shows what was
    // lifted — only the verdict goes neutral.
    expect(out.sessions).toBe(1);
    expect(out.volume).toBe(1000);
    expect(out.weeklyVolumes[7]).toBe(1000);
    expect(out.volumeDelta).toBe(0);
  });

  it('reports no change when LAST week was the easy one', () => {
    const out = computeWeeklySummary([{ ...lastWeek, deload: true }, thisWeek]);
    expect(out.volumeDelta).toBe(0);
  });

  it('never counts a deload set as a personal record', () => {
    const history = [
      workout(localNoonDaysAgo(21), [[80, 5]]),
      workout(localNoonDaysAgo(0), [[100, 5]], { deload: true }),
    ];
    expect(computeWeeklySummary(history).prsThisWeek).toBe(0);
  });

  it('still counts a real record in a normal week', () => {
    const history = [
      workout(localNoonDaysAgo(21), [[80, 5]]),
      workout(localNoonDaysAgo(0), [[100, 5]]),
    ];
    expect(computeWeeklySummary(history).prsThisWeek).toBe(1);
  });

  it('does not let a deload week lower the bar a record has to clear', () => {
    const history = [
      workout(localNoonDaysAgo(21), [[100, 5]]),            // the real best
      workout(localNoonDaysAgo(7), [[60, 5]], { deload: true }),
      workout(localNoonDaysAgo(0), [[80, 5]]),              // above the deload, below the best
    ];
    expect(computeWeeklySummary(history).prsThisWeek).toBe(0);
  });
});
